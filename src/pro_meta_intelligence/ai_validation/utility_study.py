"""Private, retrospective tool-utility pilot. Never evidence of match-winning impact.

Protocol v2 (audit fixes):
- Arms are assigned per (group, participant), so an analyst never sees the same evidence pack in
  both arms, and results are aggregated per group instead of per case.
- Evidence references must be JSON pointers into the *common* evidence. References or decision
  text naming aid fields are rejected, so the blind packet cannot reveal the arm.
- The blind packet freezes a hash of every response (including elapsed time); evaluation refuses
  responses that no longer match it and records the ratings hash in the report.

Protocol v3 adds a common draft state to every case (current bans, committed picks, previous-game
fearless locks and the role's confirmed readiness). Responses list structured BAN/PICK
recommendations; any that conflicts with that state is counted as a critical error automatically,
in both arms, whatever the raters marked. Aids are filtered by the same state, like the product.
"""

from __future__ import annotations

import hashlib
import json
import random
from statistics import mean, median

PROTOCOL_KIND = "retrospective-utility-pilot-v3"
PARTICIPANTS = 4
MIN_CASES = 30
MIN_GROUPS = 6
DRAFT_ACTIONS = ("BAN", "PICK")
# Display names and Data Dragon asset IDs that denote the same champion.
_CHAMPION_ALIASES = {"wukong": "monkeyking", "renataglasc": "renata", "nunuwillump": "nunu"}


def fingerprint(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def champion_key(name: object) -> str:
    key = "".join(ch for ch in str(name).lower() if ch.isalnum())
    return _CHAMPION_ALIASES.get(key, key)


def unavailable_champions(state: dict) -> set[str]:
    """Champions nobody can pick now: banned, already picked, or locked by an earlier game."""
    names = [*state["bans"], *state["picks"]["own"], *state["picks"]["target"]]
    return {champion_key(name) for name in [*names, *state["fearless_locked"]]}


def _names(item: object, blocked: set[str]) -> bool:
    return (
        isinstance(item, dict)
        and "champion_id" in item
        and champion_key(item["champion_id"]) in blocked
    )


def _mentions(value: object, blocked: set[str]) -> bool:
    if _names(value, blocked):
        return True
    if isinstance(value, dict):
        return any(_mentions(item, blocked) for item in value.values())
    if isinstance(value, list):
        return any(_mentions(item, blocked) for item in value)
    return False


def without_champions(value: object, blocked: set[str]) -> object:
    """Drop every entry naming a blocked champion (what the product hides), keeping the rest."""
    if isinstance(value, list):
        return [without_champions(item, blocked) for item in value if not _names(item, blocked)]
    if isinstance(value, dict):
        return {
            key: without_champions(item, blocked)
            for key, item in value.items()
            if not _names(item, blocked)
        }
    return value


def _check_draft_state(case: dict) -> dict:
    state = case["evidence"].get("draft_state")
    if not isinstance(state, dict) or not case.get("role"):
        raise ValueError("every case needs a role and a common evidence draft_state")
    picks, prepared = state.get("picks"), state.get("own_prepared")
    if (
        not isinstance(state.get("bans"), list)
        or not isinstance(state.get("fearless_locked"), list)
        or not isinstance(picks, dict)
        or any(not isinstance(picks.get(side), list) for side in ("own", "target"))
        or not isinstance(prepared, dict)
        or not isinstance(prepared.get(case["role"]), list)
    ):
        raise ValueError("draft_state needs bans, picks.own/target, fearless_locked, own_prepared")
    blocked = unavailable_champions(state)
    if any(champion_key(c) in blocked for c in prepared[case["role"]]):
        raise ValueError("a prepared champion is already unavailable in the draft state")
    if _mentions(case["aids"], blocked):
        raise ValueError("aids must be filtered by the draft state, as the product filters them")
    return state


def draft_violations(case: dict, recommendations: list[dict]) -> list[dict]:
    """Recommendations the current draft state makes impossible or unverified."""
    state = case["evidence"]["draft_state"]
    blocked = unavailable_champions(state)
    prepared = {champion_key(c) for c in state["own_prepared"][case["role"]]}
    found = []
    for item in recommendations:
        key = champion_key(item["champion_id"])
        if key in blocked:
            found.append({**item, "reason": "UNAVAILABLE_IN_CURRENT_DRAFT"})
        elif item["action"] == "PICK" and key not in prepared:
            found.append({**item, "reason": "READINESS_UNCONFIRMED"})
    return found


def _recommendations(row: dict) -> list[dict]:
    items = row.get("recommendations")
    if not isinstance(items, list) or not items:
        raise ValueError("structured BAN/PICK recommendations required")
    for item in items:
        if (
            not isinstance(item, dict)
            or set(item) != {"action", "champion_id"}
            or item["action"] not in DRAFT_ACTIONS
            or not isinstance(item["champion_id"], str)
            or not item["champion_id"]
        ):
            raise ValueError("each recommendation is exactly {action: BAN|PICK, champion_id}")
    return [dict(item) for item in items]


def freeze_study(
    cases: list[dict],
    system_version: str,
    seed: int = 20261111,
    raters: tuple[str, ...] = ("judge-a", "judge-b"),
    build: dict | None = None,
) -> dict:
    """Assign four analysts per group: two aided and two control for every case in that group."""
    if len(cases) < MIN_CASES or len({c["id"] for c in cases}) != len(cases):
        raise ValueError(f"at least {MIN_CASES} distinct cases required")
    if not system_version or any(not c.get("evidence") or not c.get("aids") for c in cases):
        raise ValueError("version, common evidence and aids required")
    if any(not c.get("group") for c in cases):
        raise ValueError("every case needs the group (evidence pack) it shares material with")
    for case in cases:
        _check_draft_state(case)
    groups = sorted({c["group"] for c in cases})
    if len(groups) < MIN_GROUPS:
        raise ValueError(f"at least {MIN_GROUPS} independent groups required")
    participants = [f"analyst-{p + 1}" for p in range(PARTICIPANTS)]
    if len(raters) != 2 or len(set(raters)) != 2 or set(raters) & set(participants):
        raise ValueError("two distinct pre-registered raters, none of them a participant")
    rng = random.Random(seed)
    assignments = []
    for index, case in enumerate(cases):
        group_index = groups.index(case["group"])
        for participant in range(PARTICIPANTS):
            assignments.append(
                {
                    "id": f"a{index:03d}-{participant}",
                    "case_id": case["id"],
                    "group": case["group"],
                    "participant": participants[participant],
                    "arm": "aided" if (group_index + participant) % 4 < 2 else "control",
                }
            )
    rng.shuffle(assignments)
    protocol = {
        "kind": PROTOCOL_KIND,
        "system_version": system_version,
        "build": build or {},
        "seed": seed,
        "cases": cases,
        "groups": groups,
        "participants": participants,
        "raters": list(raters),
        "assignments": assignments,
        "criteria": {
            "maximum_time_ratio": 0.85,
            "minimum_quality_delta": 0.0,
            "maximum_aided_critical_errors": 0,
        },
        "aggregation_unit": "group",
        "rubric": ["evidence", "actionability", "completeness"],
        "boundary": "Exploratory pilot; no causal win-rate or prospective accuracy claim.",
    }
    _check_design(protocol)
    return {"protocol": protocol, "sha256": fingerprint(protocol)}


def _check_design(protocol: dict) -> None:
    cases = {c["id"]: c for c in protocol["cases"]}
    arms: dict[tuple[str, str], set[str]] = {}
    per_case: dict[str, list[str]] = {}
    for a in protocol["assignments"]:
        if cases[a["case_id"]]["group"] != a["group"]:
            raise ValueError("assignment group does not match its case")
        arms.setdefault((a["group"], a["participant"]), set()).add(a["arm"])
        per_case.setdefault(a["case_id"], []).append(a["participant"])
    if any(len(v) != 1 for v in arms.values()):
        raise ValueError("a participant would see the same group in both arms")
    if any(sorted(v) != protocol["participants"] for v in per_case.values()) or set(
        per_case
    ) != set(cases):
        raise ValueError("every case must reach every participant exactly once")
    for group in protocol["groups"]:
        aided = sum(arms[(group, p)] == {"aided"} for p in protocol["participants"])
        if aided != PARTICIPANTS // 2:
            raise ValueError("each group needs two aided and two control participants")


def verify(study: dict) -> dict:
    protocol = study["protocol"]
    if fingerprint(protocol) != study["sha256"]:
        raise ValueError("frozen protocol changed")
    if protocol.get("kind") != PROTOCOL_KIND:
        raise ValueError("superseded protocol version; prepare a new study instead of reusing it")
    _check_design(protocol)
    return protocol


def _evidence_keys(value: object, keys: set[str]) -> set[str]:
    if isinstance(value, dict):
        for key, item in value.items():
            keys.add(str(key).lower())
            _evidence_keys(item, keys)
    elif isinstance(value, list):
        for item in value:
            _evidence_keys(item, keys)
    return keys


def aid_terms(case: dict) -> set[str]:
    """Names that only exist in the aids and would reveal the aided arm if cited."""
    terms = {"levers", "aids"}
    if isinstance(case["aids"], dict):
        terms |= {str(key).lower() for key in case["aids"]}
    return terms - _evidence_keys(case["evidence"], set())


def resolve_reference(evidence: dict, pointer: str) -> object:
    """Resolve a JSON pointer (RFC 6901) of depth >= 2 inside the common evidence."""
    if not isinstance(pointer, str) or not pointer.startswith("/"):
        raise ValueError(f"evidence reference must be a JSON pointer: {pointer!r}")
    parts = [p.replace("~1", "/").replace("~0", "~") for p in pointer[1:].split("/")]
    if len(parts) < 2:
        raise ValueError(f"evidence reference too broad: {pointer!r}")
    node: object = evidence
    for part in parts:
        if isinstance(node, dict) and part in node:
            node = node[part]
        elif isinstance(node, list) and part.isdigit() and int(part) < len(node):
            node = node[int(part)]
        else:
            raise ValueError(f"evidence reference does not exist in common evidence: {pointer!r}")
    return node


def responses_fingerprint(responses: list[dict]) -> str:
    return fingerprint(sorted(responses, key=lambda r: str(r.get("assignment_id"))))


def _response_id(study: dict, responses_sha256: str, assignment_id: str) -> str:
    # Raters never receive the responses file, so they cannot recompute this mapping.
    return fingerprint([study["sha256"], responses_sha256, assignment_id])[:20]


def blind_packet(study: dict, responses: list[dict]) -> dict:
    protocol = verify(study)
    assignments = {a["id"]: a for a in protocol["assignments"]}
    cases = {c["id"]: c for c in protocol["cases"]}
    responses_sha256 = responses_fingerprint(responses)
    seen = set()
    packet = []
    for row in responses:
        key = row["assignment_id"]
        if key not in assignments or key in seen:
            raise ValueError("unknown or duplicate assignment")
        seen.add(key)
        if not row.get("decision") or not row.get("evidence_refs"):
            raise ValueError("decision and evidence references required")
        recommendations = _recommendations(row)
        if not isinstance(row.get("elapsed_seconds"), (int, float)) or not (
            0 < row["elapsed_seconds"] < 86400
        ):
            raise ValueError("positive finite task duration required")
        case = cases[assignments[key]["case_id"]]
        terms = aid_terms(case)
        cited_text = " ".join([str(row["decision"]), *map(str, row["evidence_refs"])]).lower()
        leaked = sorted(term for term in terms if term in cited_text)
        if leaked:
            raise ValueError(f"{key} names aid-only fields {leaked}; cite common evidence only")
        refs = [
            {"pointer": ref, "value": resolve_reference(case["evidence"], ref)}
            for ref in row["evidence_refs"]
        ]
        packet.append(
            {
                "response_id": _response_id(study, responses_sha256, key),
                "case_id": case["id"],
                "decision": row["decision"],
                "recommendations": recommendations,
                "evidence_refs": refs,
                # Arm-neutral and computed, so raters and the report share one definition.
                "draft_violations": draft_violations(case, recommendations),
            }
        )
    return {
        "study_sha256": study["sha256"],
        "responses_sha256": responses_sha256,
        "responses": sorted(packet, key=lambda r: r["response_id"]),
    }


def evaluate_study(study: dict, responses: list[dict], blind: dict, ratings: list[dict]) -> dict:
    protocol = verify(study)
    if blind.get("study_sha256") != study["sha256"]:
        raise ValueError("blind packet belongs to another study")
    if responses_fingerprint(responses) != blind.get("responses_sha256"):
        raise ValueError("responses changed after the blind packet was frozen")
    packet = blind_packet(study, responses)
    if packet != blind:
        raise ValueError("blind packet does not match the frozen responses")
    assignments = {a["id"]: a for a in protocol["assignments"]}
    ids = {p["response_id"] for p in packet["responses"]}
    raters = set(protocol["raters"])
    scores: dict[str, dict] = {}
    for rating in ratings:
        response_id = rating["response_id"]
        if response_id not in ids:
            raise ValueError("unknown response")
        if rating.get("rater") not in raters:
            raise ValueError("rater was not pre-registered in the protocol")
        group = scores.setdefault(response_id, {})
        if rating["rater"] in group:
            raise ValueError("duplicate rating")
        values = [rating[key] for key in protocol["rubric"]]
        if any(type(v) is not int or not 0 <= v <= 4 for v in values):
            raise ValueError("rubric scores must be integers from zero to four")
        if type(rating.get("critical_error")) is not bool:
            raise ValueError("critical error assessment required")
        group[rating["rater"]] = rating
    frozen = {
        "study_sha256": study["sha256"],
        "responses_sha256": packet["responses_sha256"],
        "ratings_sha256": fingerprint(
            sorted(ratings, key=lambda r: (str(r.get("response_id")), str(r.get("rater"))))
        ),
    }
    if len(responses) != len(assignments) or any(len(scores.get(i, {})) != 2 for i in ids):
        return {
            "status": "PENDING_HUMAN_EVALUATION",
            "responses": len(responses),
            "required_responses": len(assignments),
            "proven_utility": False,
            **frozen,
        }
    cells: dict[tuple[str, str], dict] = {}
    critical = {"aided": 0, "control": 0}
    automatic = {"aided": 0, "control": 0}
    violations = {p["response_id"]: p["draft_violations"] for p in packet["responses"]}
    missed_by_raters = 0
    rater_gaps, critical_disagreements = [], 0
    for row in responses:
        assignment = assignments[row["assignment_id"]]
        response_id = _response_id(study, packet["responses_sha256"], assignment["id"])
        grades = list(scores[response_id].values())
        per_rater = [mean(g[k] for k in protocol["rubric"]) for g in grades]
        rater_gaps.append(abs(per_rater[0] - per_rater[1]))
        flags = [g["critical_error"] for g in grades]
        critical_disagreements += flags[0] != flags[1]
        detected = bool(violations[response_id])
        automatic[assignment["arm"]] += detected
        missed_by_raters += detected and not any(flags)
        critical[assignment["arm"]] += any(flags) or detected
        cell = cells.setdefault(
            (assignment["group"], assignment["participant"]),
            {"arm": assignment["arm"], "times": [], "qualities": []},
        )
        cell["times"].append(row["elapsed_seconds"])
        cell["qualities"].append(mean(per_rater))
    group_results = []
    for group in protocol["groups"]:
        arms: dict[str, list[dict]] = {"aided": [], "control": []}
        for participant in protocol["participants"]:
            cell = cells[(group, participant)]
            arms[cell["arm"]].append(cell)
        aided_time = median(mean(c["times"]) for c in arms["aided"])
        control_time = median(mean(c["times"]) for c in arms["control"])
        group_results.append(
            {
                "group": group,
                "time_ratio": aided_time / control_time,
                "quality_delta": mean(mean(c["qualities"]) for c in arms["aided"])
                - mean(mean(c["qualities"]) for c in arms["control"]),
            }
        )
    ratios = [g["time_ratio"] for g in group_results]
    deltas = [g["quality_delta"] for g in group_results]
    criteria = protocol["criteria"]
    passed = (
        median(ratios) <= criteria["maximum_time_ratio"]
        and mean(deltas) >= criteria["minimum_quality_delta"]
        and critical["aided"] <= criteria["maximum_aided_critical_errors"]
    )
    return {
        "status": "PILOT_CRITERIA_MET" if passed else "PILOT_CRITERIA_NOT_MET",
        "aggregation_unit": "group",
        "group_count": len(group_results),
        "case_count": len(protocol["cases"]),
        "median_group_time_ratio": median(ratios),
        "mean_group_quality_delta": mean(deltas),
        "quality_delta_range": [min(deltas), max(deltas)],
        "aided_critical_errors": critical["aided"],
        "control_critical_errors": critical["control"],
        "automatic_draft_violations": automatic,
        "violations_missed_by_raters": missed_by_raters,
        "mean_rater_gap": mean(rater_gaps),
        "critical_error_disagreements": critical_disagreements,
        "group_results": group_results,
        "proven_utility": False,
        "boundary": protocol["boundary"],
        **frozen,
    }
