"""Optional full-evidence path: season history for the frozen current-draft evaluation cohort.

Builds one player-season-history per prepared snapshot, as of exactly the physical 2374 capture
cutoff, from that verified capture only. The roster basis and roster references come from the
prepared historical snapshot report (never the published feed, never the target game's lineup).
Source verification, roster basis, building and output validation reuse
``ops.build_player_season_history`` and ``pro_meta_intelligence.opponent.player_season``.

This does not change the frozen baseline (seasonHistory = null). Its cohort was already observed,
so any comparison is an exploratory integration diagnostic, never a confirmatory trial.

Run as ``python -m ops.prepare_current_draft_season_evidence --dataset D --csv C --meta M --output
outputs/...``. There is no default input and no fallback to published history.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ops.build_player_season_history import validate_output, verify_archive
from pro_meta_intelligence.ingestion.oracles_elixir import SOURCE_ID, OracleElixirCSVAdapter
from pro_meta_intelligence.opponent.player_season import (
    build_player_season_history,
    roster_basis_from_feed,
    roster_references_from_feed,
)
from pro_meta_intelligence.sources import SourceRegistry

ROOT = Path(__file__).resolve().parents[1]
OUTPUTS = ROOT / "outputs"
ARTIFACT_TYPE = "current-draft-season-evidence"
PREPARER_VERSION = "current-draft-season-evidence-v1"
CLAIMS = (
    "BASE_COHORT_ALREADY_OBSERVED",
    "BASELINE_MISSING_SEASON_HISTORY",
    "EXPLORATORY_INTEGRATION_DIAGNOSTIC",
    "NOT_A_CONFIRMATORY_TRIAL",
    "NOT_A_FRESH_HOLDOUT",
    "NOT_PROOF_OF_UTILITY",
    "SEASON_AS_OF_2374_CAPTURE_CUTOFF",
    "ROSTER_BASIS_FROM_HISTORICAL_SNAPSHOT",
    "NO_TARGET_ROSTER_OR_ROLES",
    "NO_PUBLISHED_OR_LIVE_HISTORY_FALLBACK",
)


@dataclass(frozen=True)
class Pins:
    candidate_hash: str
    candidate_retrieved_at: datetime
    season: int
    forbidden_hashes: frozenset[str] = field(default_factory=frozenset)


FROZEN = Pins(
    candidate_hash="sha256:2374ae616a69d6d643b645d4c646b0fe9ba1fc08b16dce152feb567995234590",
    candidate_retrieved_at=datetime.fromisoformat("2026-11-04T03:03:22.056760+00:00"),
    season=2026,
    forbidden_hashes=frozenset(
        {
            # Outcome capture: must never feed inputs.
            "sha256:fcd2e451d10fd56271f151a63cf001ed8727935ef4237a34956ab4a1836944de",
            # 2022 data.
            "sha256:76b7cb8afc1c65c7e220053b1c5296c593e00c3a6dfaee4ef47373aa64b42a0a",
        }
    ),
)


def _aware(value: object, label: str) -> datetime:
    if not isinstance(value, str):
        raise ValueError(f"missing timestamp: {label}")
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        raise ValueError(f"timestamp must be timezone-aware: {label}")
    return parsed


def _validate_dataset(dataset: Any) -> None:
    if not (
        isinstance(dataset, dict)
        and dataset.get("schema_version") == "1"
        and dataset.get("artifact_type") == "draft-historical-dataset"
        and dataset.get("scope") == "FIRST_SET_IMMEDIATE_OPPONENT_PICK"
        and dataset.get("fixture_only") is False
        and isinstance(dataset.get("snapshots"), list)
        and dataset["snapshots"]
        and isinstance(dataset.get("matches"), list)
    ):
        raise ValueError("unsupported prepared draft dataset")


def _snapshot_basis(snapshot: Any, pins: Pins, source_version: str) -> dict[str, Any]:
    """Cross-validate one prepared snapshot against the verified capture; return its report."""

    if not isinstance(snapshot, dict) or not isinstance(snapshot.get("id"), str):
        raise ValueError("invalid prepared snapshot")
    report = snapshot.get("report")
    prep = report.get("opponent_prep") if isinstance(report, dict) else None
    if not isinstance(prep, dict):
        raise ValueError("MISSING_FIELD: snapshot.report.opponent_prep")
    if snapshot.get("source_hash") != pins.candidate_hash:
        raise ValueError("snapshot source is not the pinned 2374 capture")
    cutoffs = [
        _aware(snapshot.get("cutoff"), "snapshot.cutoff"),
        _aware(report.get("cutoff"), "report.cutoff"),
        _aware(prep.get("cutoff"), "opponent_prep.cutoff"),
    ]
    if any(item != pins.candidate_retrieved_at for item in cutoffs):
        raise ValueError("snapshot cutoff is not exactly the 2374 capture retrieval time")
    if report.get("fixture_only") is not False or prep.get("fixture_only") is not False:
        raise ValueError("snapshot is not real data")
    if report.get("patch_id") != prep.get("patch_id"):
        raise ValueError("snapshot patch mismatch")
    sources = [
        *((report.get("evidence_index") or {}).get("source_versions") or []),
        *((prep.get("evidence_index") or {}).get("source_versions") or []),
    ]
    if not sources or any(
        item.get("source_id") != SOURCE_ID
        or item.get("content_hash") != pins.candidate_hash
        or item.get("source_version") != source_version
        for item in sources
    ):
        raise ValueError("snapshot evidence does not cite exactly the verified capture and version")
    return report


def build_season_evidence(
    dataset_bytes: bytes,
    csv_path: Path,
    meta_path: Path,
    *,
    pins: Pins = FROZEN,
    now: datetime | None = None,
) -> dict[str, Any]:
    dataset = json.loads(dataset_bytes.decode("utf-8"))
    _validate_dataset(dataset)
    archive = verify_archive(csv_path, meta_path)
    content_hash = archive["content_hash"]
    retrieved_at = archive["retrieved_at"]
    assert isinstance(retrieved_at, datetime)
    if content_hash in pins.forbidden_hashes:
        raise ValueError("forbidden capture: outcome or 2022 source cannot supply season inputs")
    if content_hash != pins.candidate_hash:
        raise ValueError("season source is not the pinned 2374 capture")
    if retrieved_at != pins.candidate_retrieved_at:
        raise ValueError("capture retrieval time differs from the pinned 2374 capture")
    if retrieved_at > (now or datetime.now(UTC)):
        raise ValueError("capture was retrieved in the future")
    imported = OracleElixirCSVAdapter(SourceRegistry.load_default()).import_file(
        csv_path, retrieved_at=retrieved_at, source_timezone="UTC", issue_detail_limit=0
    )
    if imported.report.content_hash != content_hash:
        raise ValueError("adapter hash differs from archive metadata")
    source_version = imported.report.source_version
    targets = {match.get("match_id") for match in dataset["matches"] if isinstance(match, dict)}
    if any(match.match_id in targets for match in imported.matches):
        raise ValueError("a target match is present in the season source")

    histories = []
    seen: set[str] = set()
    for snapshot in sorted(dataset["snapshots"], key=lambda item: str(item.get("id"))):
        report = _snapshot_basis(snapshot, pins, source_version)
        if snapshot["id"] in seen:
            raise ValueError("duplicate snapshot ID")
        seen.add(snapshot["id"])
        basis = roster_basis_from_feed(report)
        references = roster_references_from_feed(report)
        if not references:
            raise ValueError("MISSING_FIELD: opponent_prep.teams[].player_profiles[].player_id")
        cutoff = _aware(basis["cutoff"], "roster_basis.cutoff")
        season = cutoff.astimezone(UTC).year
        if season != pins.season:
            raise ValueError("season year differs from the pinned 2026 season")
        history = build_player_season_history(
            imported.matches,
            imported.draft_events,
            references,
            season=season,
            cutoff=cutoff,
            roster_basis=basis,
            source={
                "source_id": SOURCE_ID,
                "source_version": source_version,
                "content_hash": content_hash,
                "retrieved_at": retrieved_at.isoformat(),
            },
            import_report=imported.report.to_dict(),
        )
        text = json.dumps(history, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        validate_output(text, season=season, basis=basis)
        if (
            history["cutoff"] != report["cutoff"]
            or history["source"]["content_hash"] != content_hash
        ):
            raise ValueError("derived history does not match its snapshot")
        histories.append(
            {
                "snapshot_id": snapshot["id"],
                "patch_id": report["patch_id"],
                "season": season,
                "cutoff": report["cutoff"],
                "roster_basis": basis,
                "roster_reference_count": len({(r.team_id, r.player_id) for r in references}),
                "history_sha256": "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest(),
                "history_json": text,
            }
        )
    return {
        "schema_version": "1",
        "artifact_type": ARTIFACT_TYPE,
        "preparer_version": PREPARER_VERSION,
        "dataset_sha256": "sha256:" + hashlib.sha256(dataset_bytes).hexdigest(),
        "season": pins.season,
        "source": {
            "source_id": SOURCE_ID,
            "source_version": source_version,
            "content_hash": content_hash,
            "retrieved_at": retrieved_at.isoformat(),
        },
        "claims": list(CLAIMS),
        "histories": histories,
        "boundary": "Season evidence for an already-observed cohort, from the 2374 capture only, "
        "as of its retrieval time, with the roster basis of each historical snapshot. "
        "Exploratory integration diagnostic; not a fresh holdout or proof of utility.",
    }


def _under_outputs(path: Path) -> Path:
    resolved = path.resolve()
    if OUTPUTS.resolve() not in resolved.parents:
        raise ValueError("season evidence output must be under ignored outputs/")
    return resolved


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--csv", type=Path, required=True)
    parser.add_argument("--meta", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    output = _under_outputs(args.output)
    evidence = build_season_evidence(args.dataset.read_bytes(), args.csv, args.meta)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(evidence, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "status": "BUILT",
                "histories": len(evidence["histories"]),
                "source": evidence["source"]["content_hash"],
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
