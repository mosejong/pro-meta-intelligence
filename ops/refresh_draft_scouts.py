"""Refresh fixed public scouting packs from an already acquired, validated CSV (no network)."""

import argparse
import json
import os
import tempfile
from datetime import datetime
from pathlib import Path

from pro_meta_intelligence.ingestion.oracles_elixir import OracleElixirCSVAdapter
from pro_meta_intelligence.opponent import DraftScoutBuilder, DraftScoutConfig
from pro_meta_intelligence.quality.team_coverage import audit_team_coverage
from pro_meta_intelligence.radar.models import LeagueRegionMap
from pro_meta_intelligence.sources import SnapshotArchive, SourceRegistry

TARGETS = {
    "kc": "Karmine Corp",
    "tes": "Top Esports",
    "ig": "Invictus Gaming",
    "gen": "Gen.G",
    "lyon": "LYON",
    "dk": "Dplus Kia",
    "blg": "Bilibili Gaming",
}


def refresh_scouts(path, retrieved_at, output_dir, *, targets=None, own_team="T1"):
    targets = TARGETS if targets is None else targets
    if any(not code.isalnum() for code in targets):
        raise ValueError("unsafe target code")
    imported = OracleElixirCSVAdapter(SourceRegistry.load_default()).import_file(
        path, retrieved_at=retrieved_at, source_timezone="UTC", issue_detail_limit=None
    )
    coverage = audit_team_coverage(path, imported, tuple(targets.values()) + (own_team,))
    pending = {}
    for code, name in targets.items():
        report = (
            DraftScoutBuilder()
            .build(
                imported.matches,
                imported.draft_events,
                LeagueRegionMap.load_default(),
                DraftScoutConfig(
                    cutoff=retrieved_at, target_team_name=name, own_team_name=own_team
                ),
            )
            .to_dict()
        )
        for side, team in (("target", name), ("own", own_team)):
            report[side]["import_coverage"] = {
                k: v for k, v in coverage["teams"][team].items() if k != "excluded_game_details"
            }
        report["source_version"] = imported.report.source_version
        dest = output_dir / f"t1-vs-{code}.json"
        if dest.exists():
            old = json.loads(dest.read_text(encoding="utf-8"))
            if datetime.fromisoformat(old["cutoff"]) > retrieved_at:
                raise ValueError("refusing to move a scouting pack backward")
        pending[dest] = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    # Build every target before changing any accepted file. A failed workflow never deploys.
    output_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".scout-stage-", dir=output_dir) as stage:
        for dest, value in pending.items():
            (Path(stage) / dest.name).write_text(value, encoding="utf-8")
        # Keep the accepted bytes so a failure part-way through never leaves mixed cutoffs.
        accepted = {dest: dest.read_bytes() if dest.exists() else None for dest in pending}
        replaced = []
        try:
            for dest in pending:
                os.replace(Path(stage) / dest.name, dest)
                replaced.append(dest)
        except BaseException:
            for dest in replaced:
                if accepted[dest] is None:
                    dest.unlink(missing_ok=True)
                else:
                    dest.write_bytes(accepted[dest])
            raise
    return {
        "status": "REFRESHED",
        "pack_count": len(pending),
        "cutoff": retrieved_at.isoformat(),
        "source_version": imported.report.source_version,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--input", type=Path)
    source.add_argument("--feed", type=Path)
    parser.add_argument("--retrieved-at")
    parser.add_argument("--archive-dir", type=Path, default=Path("outputs/oracles-elixir/raw"))
    parser.add_argument("--output-dir", type=Path, default=Path("web/app/scouting"))
    args = parser.parse_args()
    if args.feed:
        feed = json.loads(args.feed.read_text(encoding="utf-8"))
        original = feed["input"]["import_report"]
        retrieved = datetime.fromisoformat(original["retrieved_at"])
        # Exactly the accepted feed's source, never an arbitrary newest or rejected snapshot.
        inspection = SnapshotArchive(args.archive_dir).inspect("oracles-elixir-match-data")
        if inspection.issues:
            raise ValueError("archive integrity issues")
        snapshot = next(
            (
                s
                for s in inspection.snapshots
                if s.content_hash == original["content_hash"] and s.retrieved_at == retrieved
            ),
            None,
        )
        if snapshot is None:
            raise ValueError("accepted feed source not found in verified archive")
        path = snapshot.data_path
    else:
        if not args.retrieved_at:
            parser.error("--input requires its actual --retrieved-at")
        path, retrieved = args.input, datetime.fromisoformat(args.retrieved_at)
    print(json.dumps(refresh_scouts(path, retrieved, args.output_dir)))
