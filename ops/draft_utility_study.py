"""Build private pilot materials, blind responses, or evaluate independent ratings."""

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

from pro_meta_intelligence.ai_validation import utility_study
from pro_meta_intelligence.ai_validation.utility_study import (
    blind_packet,
    evaluate_study,
    freeze_study,
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


def build_cases(packs: Path) -> list[dict]:
    cases = []
    for path in sorted(packs.glob("t1-vs-*.json")):
        pack = json.loads(path.read_text(encoding="utf-8"))
        for role in ROLES:
            cases.append(
                {
                    "id": f"{path.stem}-{role}",
                    "group": path.stem,
                    "role": role,
                    # Collection time, not a pre-match cutoff: packs can include finished games.
                    "collected_at": pack["cutoff"],
                    "framing": "RETROSPECTIVE_HYPOTHETICAL",
                    "source_sha256": sha256_file(path),
                    "prompt": f"For {role}, recommend a target ban, an open trade "
                    "and an own pick priority; "
                    "cite evidence, uncertainty and missing preparation information. "
                    "Cite evidence only as JSON pointers into the common evidence.",
                    "evidence": {
                        k: pack[k] for k in ("target", "own", "head_to_head", "league_meta")
                    },
                    "aids": pack["levers"],
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
