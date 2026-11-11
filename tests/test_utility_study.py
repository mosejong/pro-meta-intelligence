import copy

import pytest

from pro_meta_intelligence.ai_validation.utility_study import (
    blind_packet,
    evaluate_study,
    freeze_study,
    verify,
)

EVIDENCE = {"target": {"picks": ["Orianna", "Vi"]}, "own": {"picks": ["Azir"]}}
AIDS = {"deny_comfort": ["Orianna"], "expected_picks": ["Vi"]}


def cases(groups=7, per_group=5):
    return [
        {"id": f"g{g}-r{r}", "group": f"g{g}", "evidence": EVIDENCE, "aids": AIDS}
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


def test_superseded_v1_protocol_is_refused():
    frozen = study()
    frozen["protocol"]["kind"] = "retrospective-utility-pilot"
    from pro_meta_intelligence.ai_validation.utility_study import fingerprint

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
