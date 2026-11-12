"""Build private pilot materials, blind responses, or evaluate independent ratings."""

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

from pro_meta_intelligence.ai_validation import utility_study
from pro_meta_intelligence.ai_validation.utility_study import (
    blind_packet,
    champion_key,
    evaluate_study,
    freeze_study,
    unavailable_champions,
    without_champions,
)

ROLES = ("TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT")


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_record() -> dict:
    """Record what was actually evaluated: git HEAD, dirty state and the study code hashes."""

    def git(*args):
        try:
            return subprocess.run(
                ["git", *args], capture_output=True, text=True, check=True
            ).stdout.strip()
        except (OSError, subprocess.CalledProcessError):
            return None

    status = git("status", "--porcelain")
    return {
        "git_head": git("rev-parse", "HEAD"),
        "git_dirty": None if status is None else bool(status),
        "code_sha256": {
            "utility_study.py": sha256_file(Path(utility_study.__file__)),
            "draft_utility_study.py": sha256_file(Path(__file__)),
        },
    }


def draft_state_for(pack: dict, role: str) -> dict:
    """A fixed game-2 position shared by both arms, built only from the common evidence.

    The most played cards of the role's two players are taken first, so the strongest-looking
    recommendations are exactly the ones the state makes illegal.
    """

    def pool(side):
        group = next((g for g in pack[side]["player_pools"] if g["role"] == role), None)
        return [c["champion_id"] for c in (group or {}).get("champions", [])]

    used = set()

    def take(champions, count):
        chosen = [c for c in champions if champion_key(c) not in used][:count]
        used.update(champion_key(c) for c in chosen)
        return chosen

    own, target = pool("own"), pool("target")
    locked = take(own, 1) + take(target, 1)
    bans = take(target, 1) + take(own, 1)
    target_pick = take(target, 1)
    return {
        "game": 2,
        "fearless_locked": locked,
        "bans": bans,
        "picks": {"own": [], "target": target_pick},
        # Readiness is confirmed only for these cards in this role; everything else is unknown.
        "own_prepared": {role: take(own, 3)},
    }


def build_cases(packs: Path) -> list[dict]:
    cases = []
    for path in sorted(packs.glob("t1-vs-*.json")):
        pack = json.loads(path.read_text(encoding="utf-8"))
        for role in ROLES:
            state = draft_state_for(pack, role)
            cases.append(
                {
                    "id": f"{path.stem}-{role}",
                    "group": path.stem,
                    "role": role,
                    # Collection time, not a pre-match cutoff: packs can include finished games.
                    "collected_at": pack["cutoff"],
                    "framing": "RETROSPECTIVE_HYPOTHETICAL",
                    "source_sha256": sha256_file(path),
                    "prompt": f"Game 2 of a fearless series, state in /draft_state. For {role}, "
                    "recommend a target ban, an open trade and an own pick priority; "
                    "cite evidence, uncertainty and missing preparation information. "
                    "List every recommended champion as {action: BAN|PICK, champion_id}. "
                    "Cite evidence only as JSON pointers into the common evidence.",
                    "evidence": {
                        **{k: pack[k] for k in ("target", "own", "head_to_head", "league_meta")},
                        "draft_state": state,
                    },
                    # The product hides unavailable cards; the aids get the same filter.
                    "aids": without_champions(pack["levers"], unavailable_champions(state)),
                }
            )
    return cases


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["prepare", "blind", "evaluate"])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--packs", type=Path, default=Path("web/app/scouting"))
    parser.add_argument("--version")
    parser.add_argument("--study", type=Path)
    parser.add_argument("--responses", type=Path)
    parser.add_argument("--blind", type=Path)
    parser.add_argument("--ratings", type=Path)
    args = parser.parse_args()

    def read(path):
        if path is None:
            parser.error("required input path missing")
        return json.loads(path.read_text(encoding="utf-8"))

    if args.output.exists():
        parser.error("output exists; frozen materials must not be overwritten")
    if args.mode == "prepare":
        if not args.version:
            parser.error("--version must pin the tested build")
        result = freeze_study(build_cases(args.packs), args.version, build=build_record())
    elif args.mode == "blind":
        result = blind_packet(read(args.study), read(args.responses))
    else:
        result = evaluate_study(
            read(args.study), read(args.responses), read(args.blind), read(args.ratings)
        )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
