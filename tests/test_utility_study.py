import copy
from pathlib import Path

import pytest

from pro_meta_intelligence.ai_validation.utility_study import (
    blind_packet,
    evaluate_study,
    freeze_study,
    verify,
)

ROOT = Path(__file__).resolve().parents[1]
DRAFT_STATE = {
    "game": 2,
    "bans": ["Ahri"],
    "fearless_locked": ["MonkeyKing"],
    "picks": {"own": [], "target": ["Vi"]},
    "own_prepared": {"MID": ["Azir", "Taliyah"]},
}
EVIDENCE = {
    "target": {"picks": ["Orianna", "Vi"]},
    "own": {"picks": ["Azir"]},
    "draft_state": DRAFT_STATE,
}
AIDS = {"deny_comfort": [{"champion_id": "Orianna"}], "expected_picks": [{"champion_id": "Sylas"}]}
LEGAL = [{"action": "BAN", "champion_id": "Orianna"}, {"action": "PICK", "champion_id": "Azir"}]


def cases(groups=7, per_group=5):
    return [
        {"id": f"g{g}-r{r}", "group": f"g{g}", "role": "MID", "evidence": EVIDENCE, "aids": AIDS}
        for g in range(groups)
        for r in range(per_group)
    ]


def study():
    return freeze_study(cases(), "fixture-build")


def responses_for(frozen, aided_seconds=80, control_seconds=100):
    return [
        {
            "assignment_id": a["id"],
            "decision": "ban Orianna, keep Azir",
            "recommendations": copy.deepcopy(LEGAL),
            "evidence_refs": ["/target/picks/0"],
            "elapsed_seconds": aided_seconds if a["arm"] == "aided" else control_seconds,
        }
        for a in frozen["protocol"]["assignments"]
    ]


def ratings_for(blind, critical=False):
    return [
        {
            "response_id": p["response_id"],
            "rater": rater,
            "evidence": 3,
            "actionability": 3,
            "completeness": 3,
            "critical_error": critical,
        }
        for p in blind["responses"]
        for rater in ("judge-a", "judge-b")
    ]


def test_arms_are_blocked_by_group_so_no_analyst_sees_a_pack_in_both_arms():
    assignments = study()["protocol"]["assignments"]
    arms = {}
    for a in assignments:
        arms.setdefault((a["group"], a["participant"]), set()).add(a["arm"])
    assert all(len(value) == 1 for value in arms.values())
    for g in range(7):
        group_arms = [next(iter(arms[(f"g{g}", f"analyst-{p}")])) for p in range(1, 5)]
        assert group_arms.count("aided") == 2
    for c in cases():
        rows = [a for a in assignments if a["case_id"] == c["id"]]
        assert len({r["participant"] for r in rows}) == 4


def test_cross_arm_exposure_in_a_tampered_design_is_rejected():
    frozen = study()
    target = next(a for a in frozen["protocol"]["assignments"] if a["group"] == "g0")
    target["arm"] = "control" if target["arm"] == "aided" else "aided"
    with pytest.raises(ValueError):
        verify(frozen)


def test_too_few_groups_or_missing_group_is_rejected():
    with pytest.raises(ValueError, match="groups"):
        freeze_study(cases(groups=3, per_group=10), "fixture-build")
    ungrouped = cases()
    del ungrouped[0]["group"]
    with pytest.raises(ValueError, match="group"):
        freeze_study(ungrouped, "fixture-build")


def test_superseded_v1_and_v2_protocols_are_refused():
    frozen = study()
    from pro_meta_intelligence.ai_validation.utility_study import fingerprint

    for kind in ("retrospective-utility-pilot", "retrospective-utility-pilot-v2"):
        frozen["protocol"]["kind"] = kind
        frozen["sha256"] = fingerprint(frozen["protocol"])
        with pytest.raises(ValueError, match="superseded"):
            verify(frozen)


@pytest.mark.parametrize(
    "decision, refs",
    [
        ("ban Orianna", ["levers.deny_comfort"]),
        ("deny_comfort says Orianna", ["/target/picks/0"]),
        ("ban Orianna", ["/aids/deny_comfort/0"]),
    ],
)
def test_aid_only_citations_cannot_reach_raters(decision, refs):
    frozen = study()
    rows = responses_for(frozen)
    rows[0]["decision"], rows[0]["evidence_refs"] = decision, refs
    with pytest.raises(ValueError):
        blind_packet(frozen, rows)


@pytest.mark.parametrize("ref", ["/target/picks/9", "/target", "target.picks", "/missing/x"])
def test_references_must_resolve_inside_common_evidence(ref):
    frozen = study()
    rows = responses_for(frozen)
    rows[0]["evidence_refs"] = [ref]
    with pytest.raises(ValueError):
        blind_packet(frozen, rows)


def test_blind_packet_hides_arm_and_carries_resolved_common_evidence():
    frozen = study()
    blind = blind_packet(frozen, responses_for(frozen))
    text = str(blind["responses"])
    assert "aided" not in text and "control" not in text and "analyst" not in text
    assert "elapsed" not in text and "levers" not in text
    assert blind["responses"][0]["evidence_refs"] == [
        {"pointer": "/target/picks/0", "value": "Orianna"}
    ]


def test_complete_pilot_reports_hashes_and_never_proves_utility():
    frozen = study()
    responses = responses_for(frozen)
    blind = blind_packet(frozen, responses)
    report = evaluate_study(frozen, responses, blind, ratings_for(blind))
    assert report["status"] == "PILOT_CRITERIA_MET"
    assert report["proven_utility"] is False
    assert report["aggregation_unit"] == "group" and report["group_count"] == 7
    assert report["responses_sha256"] == blind["responses_sha256"]
    assert len(report["ratings_sha256"]) == 64
    critical = evaluate_study(frozen, responses, blind, ratings_for(blind, critical=True))
    assert critical["status"] == "PILOT_CRITERIA_NOT_MET"
    assert critical["control_critical_errors"] == 70
    assert report["automatic_draft_violations"] == {"aided": 0, "control": 0}


def test_responses_edited_after_blinding_are_refused():
    frozen = study()
    responses = responses_for(frozen)
    blind = blind_packet(frozen, responses)
    edited = copy.deepcopy(responses)
    edited[0]["elapsed_seconds"] = 1
    with pytest.raises(ValueError, match="changed after"):
        evaluate_study(frozen, edited, blind, ratings_for(blind))
    other = freeze_study(cases(), "other-build")
    with pytest.raises(ValueError, match="another study"):
        evaluate_study(other, responses, blind, [])


def test_unregistered_or_duplicate_raters_and_empty_results():
    frozen = study()
    responses = responses_for(frozen)
    blind = blind_packet(frozen, responses)
    ratings = ratings_for(blind)
    ratings[0]["rater"] = "judge-c"
    with pytest.raises(ValueError, match="pre-registered"):
        evaluate_study(frozen, responses, blind, ratings)
    with pytest.raises(ValueError, match="duplicate"):
        evaluate_study(frozen, responses, blind, ratings_for(blind) + ratings_for(blind)[:1])
    with pytest.raises(ValueError, match="duplicate"):
        blind_packet(frozen, responses + responses[:1])
    with pytest.raises(ValueError):
        freeze_study(cases(), "fixture-build", raters=("analyst-1", "judge-b"))
    empty = blind_packet(frozen, [])
    assert evaluate_study(frozen, [], empty, [])["status"] == "PENDING_HUMAN_EVALUATION"


@pytest.mark.parametrize(
    "recommendation, reason",
    [
        ({"action": "PICK", "champion_id": "Wukong"}, "UNAVAILABLE_IN_CURRENT_DRAFT"),
        ({"action": "BAN", "champion_id": "Ahri"}, "UNAVAILABLE_IN_CURRENT_DRAFT"),
        ({"action": "BAN", "champion_id": "Vi"}, "UNAVAILABLE_IN_CURRENT_DRAFT"),
        ({"action": "PICK", "champion_id": "Sylas"}, "READINESS_UNCONFIRMED"),
    ],
)
def test_recommendations_breaking_the_common_draft_state_are_detected(recommendation, reason):
    frozen = study()
    rows = responses_for(frozen)
    rows[0]["recommendations"].append(recommendation)
    blind = blind_packet(frozen, rows)
    flagged = [p for p in blind["responses"] if p["draft_violations"]]
    assert len(flagged) == 1
    assert flagged[0]["draft_violations"] == [{**recommendation, "reason": reason}]


def test_detected_violations_count_as_critical_even_when_raters_miss_them():
    frozen = study()
    rows = responses_for(frozen)
    arms = {a["id"]: a["arm"] for a in frozen["protocol"]["assignments"]}
    aided = next(r for r in rows if arms[r["assignment_id"]] == "aided")
    control = next(r for r in rows if arms[r["assignment_id"]] == "control")
    aided["recommendations"].append({"action": "PICK", "champion_id": "MonkeyKing"})
    control["recommendations"].append({"action": "PICK", "champion_id": "Sylas"})
    blind = blind_packet(frozen, rows)
    report = evaluate_study(frozen, rows, blind, ratings_for(blind, critical=False))
    assert report["automatic_draft_violations"] == {"aided": 1, "control": 1}
    assert report["aided_critical_errors"] == 1 and report["control_critical_errors"] == 1
    assert report["violations_missed_by_raters"] == 2
    assert report["status"] == "PILOT_CRITERIA_NOT_MET"


@pytest.mark.parametrize(
    "recommendations",
    [None, [], [{"action": "COUNTER", "champion_id": "Azir"}], [{"action": "PICK"}]],
)
def test_responses_need_structured_recommendations(recommendations):
    frozen = study()
    rows = responses_for(frozen)
    rows[0]["recommendations"] = recommendations
    with pytest.raises(ValueError, match="recommendation"):
        blind_packet(frozen, rows)


def test_cases_need_a_draft_state_and_aids_filtered_by_it():
    missing = cases()
    missing[0] = {**missing[0], "evidence": {"target": EVIDENCE["target"]}}
    with pytest.raises(ValueError, match="draft_state"):
        freeze_study(missing, "fixture-build")
    leaking = cases()
    leaking[0] = {**leaking[0], "aids": {"deny_comfort": [{"champion_id": "Wukong"}]}}
    with pytest.raises(ValueError, match="filtered"):
        freeze_study(leaking, "fixture-build")


def aid_champions(node):
    from pro_meta_intelligence.ai_validation.utility_study import champion_key

    if isinstance(node, dict):
        if "champion_id" in node:
            yield champion_key(node["champion_id"])
        for value in node.values():
            yield from aid_champions(value)
    elif isinstance(node, list):
        for value in node:
            yield from aid_champions(value)


def test_real_packs_give_every_case_a_binding_state_and_filtered_aids():
    from ops.draft_utility_study import build_cases
    from pro_meta_intelligence.ai_validation.utility_study import (
        champion_key,
        unavailable_champions,
    )

    real = build_cases(ROOT / "web/app/scouting")
    assert len(real) == 35
    frozen = freeze_study(real, "fixture-build")
    for case in frozen["protocol"]["cases"]:
        state = case["evidence"]["draft_state"]
        blocked = unavailable_champions(state)
        assert len(state["fearless_locked"]) == 2 and len(state["bans"]) == 2
        assert state["own_prepared"][case["role"]]
        pool = next(g for g in case["evidence"]["own"]["player_pools"] if g["role"] == case["role"])
        # The own player's most played card is the trap: shown in evidence, illegal to pick.
        assert champion_key(pool["champions"][0]["champion_id"]) in blocked
        assert not blocked & set(aid_champions(case["aids"]))
