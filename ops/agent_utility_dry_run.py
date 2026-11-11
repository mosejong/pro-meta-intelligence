"""Prepare isolated agent-only rehearsal packets; never populate human-study results."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
from statistics import mean

from pro_meta_intelligence.ai_validation.utility_study import fingerprint

CASES = (
    ("kc", "SUPPORT"),
    ("blg", "MID"),
    ("gen", "JUNGLE"),
    ("dk", "TOP"),
    ("tes", "BOTTOM"),
    ("ig", "SUPPORT"),
    ("lyon", "MID"),
)


def compact_profile(profile: dict, role: str) -> dict:
    result = {
        k: copy.deepcopy(profile[k])
        for k in ("team_name", "game_count", "window", "phase_one_bans", "import_coverage")
        if k in profile
    }
    for key in ("player_pools", "season_tendencies"):
        result[key] = [copy.deepcopy(p) for p in profile.get(key, []) if p["role"] == role]
    # Keep every count, but at most two example event references per season champion.
    for player in result["season_tendencies"]:
        for champion in player["champions"]:
            champion["evidence_ids"] = champion.get("evidence_ids", [])[:2]
    return result


def prepare(packs: Path, output: Path) -> dict:
    if output.exists():
        raise ValueError("new output directory required")
    cases = []
    for index, (team, role) in enumerate(CASES):
        raw = (packs / f"t1-vs-{team}.json").read_bytes()
        pack = json.loads(raw)
        expected = next(p for p in pack["levers"]["expected_picks"] if p["role"] == role)
        # Deliberately block a high-ranked pick in alternating cases.
        locked = [expected["champions"][0]["champion_id"]] if index % 2 == 0 else []
        evidence = {
            "cutoff": pack["cutoff"],
            "role": role,
            "target": compact_profile(pack["target"], role),
            "own": compact_profile(pack["own"], role),
            "international_role_meta": next(
                (
                    g.get("role_picks", {}).get(role, [])
                    for g in pack["league_meta"]
                    if g["group"] == "INTERNATIONAL"
                ),
                [],
            ),
            "context": {
                "unavailable_champions": locked,
                "own_preparation": "UNKNOWN",
                "current_turn": "OWN_BAN",
                "side": "UNKNOWN",
                "boundary": "Hypothetical review, not a complete legal draft simulation.",
            },
        }
        cases.append(
            {
                "case_id": f"case-{index + 1:02d}",
                "evidence": evidence,
                "aids": {
                    "expected_picks": expected,
                    "deny_comfort": [
                        v for v in pack["levers"]["deny_comfort"] if v.get("role") == role
                    ],
                },
                "source_sha256": hashlib.sha256(raw).hexdigest(),
            }
        )
    manifest = {
        "kind": "AGENT_ONLY_DRY_RUN",
        "cases": cases,
        "criteria": "Evidence, actionable conditional trade, completeness, no critical errors",
        "human_utility_proven": False,
        "time_comparison": "NOT_MEASURED",
    }
    manifest["sha256"] = fingerprint(manifest)
    output.mkdir(parents=True)
    (output / "manifest-private.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    for participant in range(4):
        rows = []
        for index, case in enumerate(cases):
            aided = (index + participant) % 4 < 2
            row = {"case_id": case["case_id"], "evidence": case["evidence"]}
            if aided:
                row["recommendation_summary"] = case["aids"]
            rows.append(row)
        (output / f"analyst-{participant + 1}-input.json").write_text(
            json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    return {
        "cases": len(cases),
        "analysts": 4,
        "responses_expected": len(cases) * 4,
        "manifest_sha256": manifest["sha256"],
    }


def resolve_pointer(document: object, pointer: str) -> object:
    if not pointer.startswith("/"):
        raise ValueError("absolute JSON pointer required")
    current = document
    for part in pointer[1:].split("/"):
        key = part.replace("~1", "/").replace("~0", "~")
        current = current[int(key)] if isinstance(current, list) else current[key]
    return current


def collect(output: Path) -> dict:
    """Validate complete responses and produce a condition-masked rating packet."""
    packet, private = [], []
    manifest = json.loads((output / "manifest-private.json").read_text(encoding="utf-8"))
    frozen = {k: v for k, v in manifest.items() if k != "sha256"}
    if fingerprint(frozen) != manifest["sha256"]:
        raise ValueError("manifest changed")
    for participant in range(1, 5):
        inputs = json.loads(
            (output / f"analyst-{participant}-input.json").read_text(encoding="utf-8")
        )
        expected_inputs = []
        for index, case in enumerate(manifest["cases"]):
            expected_case = {"case_id": case["case_id"], "evidence": case["evidence"]}
            if (index + participant - 1) % 4 < 2:
                expected_case["recommendation_summary"] = case["aids"]
            expected_inputs.append(expected_case)
        if inputs != expected_inputs:
            raise ValueError("participant packet changed after freeze")
        rows = json.loads(
            (output / f"analyst-{participant}-responses.json").read_text(encoding="utf-8")
        )
        expected = {c["case_id"] for c in inputs}
        if len(rows) != len(expected) or {r["case_id"] for r in rows} != expected:
            raise ValueError("each assigned case requires exactly one response")
        for row in rows:
            index = next(i for i, c in enumerate(inputs) if c["case_id"] == row["case_id"])
            if not row.get("decision") or not row.get("evidence_refs"):
                raise ValueError("decision and evidence references required")
            for ref in row["evidence_refs"]:
                if not ref.startswith(f"/{index}/"):
                    raise ValueError("cross-case reference")
                resolve_pointer(inputs, ref)
            response_id = fingerprint([manifest["sha256"], participant, row])[:20]
            packet.append(
                {
                    "response_id": response_id,
                    "case_id": row["case_id"],
                    "decision": row["decision"],
                    "evidence_refs": row["evidence_refs"],
                    "critical_concerns": row.get("critical_concerns", []),
                    "reference_values": [
                        resolve_pointer(inputs, ref) for ref in row["evidence_refs"]
                    ],
                    "common_evidence": inputs[index]["evidence"],
                }
            )
            private.append(
                {
                    "response_id": response_id,
                    "participant": participant,
                    "case_id": row["case_id"],
                    "arm": "aided" if "recommendation_summary" in inputs[index] else "control",
                }
            )
    packet.sort(key=lambda r: r["response_id"])
    (output / "blind-packet.json").write_text(
        json.dumps(packet, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    mapping = {"rows": private, "packet_sha256": fingerprint(packet)}
    (output / "response-map-private.json").write_text(
        json.dumps(mapping, indent=2), encoding="utf-8"
    )
    return {
        "responses": len(packet),
        "reference_integrity": "PASSED",
        "boundary": "References resolve; factual entailment requires independent rating.",
    }


def report(output: Path) -> dict:
    packet = json.loads((output / "blind-packet.json").read_text(encoding="utf-8"))
    mapping = json.loads((output / "response-map-private.json").read_text(encoding="utf-8"))
    if fingerprint(packet) != mapping["packet_sha256"]:
        raise ValueError("rating packet changed")
    rubric = ("evidence", "actionability", "completeness")
    scores = {}
    for judge in (1, 2):
        rows = json.loads((output / f"judge-{judge}-ratings.json").read_text(encoding="utf-8"))
        if len(rows) != len(packet) or {r["response_id"] for r in rows} != {
            p["response_id"] for p in packet
        }:
            raise ValueError("complete unique independent ratings required")
        for row in rows:
            if any(type(row.get(k)) is not int or not 0 <= row[k] <= 4 for k in rubric):
                raise ValueError("invalid rubric score")
            if type(row.get("critical_error")) is not bool or not row.get("rationale"):
                raise ValueError("critical error flag and rationale required")
            scores.setdefault(row["response_id"], []).append(row)
    arms = {}
    case_scores = {}
    disagreements = []
    for entry in mapping["rows"]:
        grades = scores[entry["response_id"]]
        arm = arms.setdefault(entry["arm"], {"quality": [], "critical_responses": 0})
        quality = mean(mean(g[k] for k in rubric) for g in grades)
        arm["quality"].append(quality)
        case_scores.setdefault(entry["case_id"], {}).setdefault(entry["arm"], []).append(quality)
        arm["critical_responses"] += any(g["critical_error"] for g in grades)
        if grades[0]["critical_error"] != grades[1]["critical_error"]:
            disagreements.append(entry["response_id"])
    return {
        "kind": "AGENT_ONLY_DRY_RUN",
        "responses": len(packet),
        "ratings": sum(len(v) for v in scores.values()),
        "arms": {
            k: {
                "mean_quality": mean(v["quality"]),
                "maximum_score_responses": sum(q == 4 for q in v["quality"]),
                "responses": len(v["quality"]),
                "critical_responses": v["critical_responses"],
            }
            for k, v in arms.items()
        },
        "critical_rating_disagreements": disagreements,
        "case_quality": {
            case: {
                **{arm: mean(values) for arm, values in groups.items()},
                "aided_minus_control": mean(groups["aided"]) - mean(groups["control"]),
            }
            for case, groups in sorted(case_scores.items())
        },
        "time_comparison": "NOT_MEASURED",
        "human_utility_proven": False,
        "boundary": "Same-model rehearsal, incomplete blinding, seven synthetic contexts; "
        "neither independent human validation nor match-win evidence.",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--packs", type=Path, default=Path("web/app/scouting"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--mode", choices=("prepare", "collect", "report"), default="prepare")
    args = parser.parse_args()
    result = (
        prepare(args.packs, args.output)
        if args.mode == "prepare"
        else collect(args.output)
        if args.mode == "collect"
        else report(args.output)
    )
    if args.mode == "report":
        (args.output / "report.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))
