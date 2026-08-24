from copy import deepcopy

import pytest

from pro_meta_intelligence.creator import CreatorBriefBuilder


def radar_report(*, eligible: bool = True) -> dict:
    return {
        "schema_version": "1",
        "fixture_only": True,
        "cutoff": "2026-08-15T12:00:00+00:00",
        "patch_id": "16.14",
        "windows": {"recent": {"days": 7}},
        "evidence_index": {
            "source_versions": [
                {
                    "source_id": "synthetic-meta-radar-v1",
                    "source_version": "v1",
                    "content_hash": "fixture:meta-radar-v1",
                }
            ]
        },
        "entries": [
            {
                "rank": 1,
                "champion_id": "RekSai",
                "role": "JUNGLE",
                "eligible_for_review": eligible,
                "quality_flags": [] if eligible else ["LOW_CURRENT_PICK_COUNT"],
                "metrics": {
                    "current_pick_count": 2,
                    "prior_pick_count": 0,
                    "current_pick_presence": 0.5,
                    "prior_pick_presence": 0.0,
                    "pick_presence_delta": 0.5,
                    "current_distinct_team_count": 2,
                    "prior_distinct_team_count": 0,
                    "current_demand": 0.25,
                    "prior_demand": 0.0,
                    "demand_velocity": 0.25,
                    "team_concentration": 0.5,
                    "regional_divergence": 0.5,
                    "most_divergent_region": "KOREA",
                    "most_divergent_region_delta": 0.5,
                },
                "region_presence": [
                    {
                        "region": "KOREA",
                        "match_count": 2,
                        "pick_count": 2,
                        "pick_presence": 1.0,
                        "delta_from_global": 0.5,
                        "sample_eligible": True,
                    }
                ],
                "evidence_event_ids": ["r-kr-1:RekSai:1", "r-kr-2:RekSai:1"],
            }
        ],
    }


def test_creator_brief_preserves_claims_counterpoint_and_evidence() -> None:
    brief = CreatorBriefBuilder().build(radar_report()).to_dict()
    topic = brief["topic_candidates"][0]

    assert brief["publication_ready"] is False
    assert brief["human_review_required"] is True
    assert topic["candidate_id"] == "RekSai:JUNGLE"
    assert [claim["metric"] for claim in topic["approved_claims"]] == [
        "pick_presence_delta",
        "demand_velocity",
        "most_divergent_region_delta",
    ]
    assert "+50.0pp" in topic["approved_claims"][0]["text"]
    assert topic["evidence_event_ids"] == ["r-kr-1:RekSai:1", "r-kr-2:RekSai:1"]
    assert topic["review_state"] == "HUMAN_REVIEW_REQUIRED"


def test_creator_brief_does_not_promote_ineligible_candidates() -> None:
    brief = CreatorBriefBuilder().build(radar_report(eligible=False)).to_dict()

    assert brief["topic_candidates"] == []
    assert brief["warnings"] == ["NO_ELIGIBLE_CANDIDATES"]


def test_creator_brief_is_deterministic_and_rejects_bad_contracts() -> None:
    report = radar_report()
    builder = CreatorBriefBuilder()

    assert builder.build(report).to_json() == builder.build(deepcopy(report)).to_json()
    with pytest.raises(ValueError, match="top_k"):
        builder.build(report, top_k=0)
    with pytest.raises(ValueError, match="schema_version"):
        builder.build({"schema_version": "2"})
