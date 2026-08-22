import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from pro_meta_intelligence.models import (
    DraftAction,
    MatchRecord,
    PickBanEvent,
    Provenance,
    Side,
)
from pro_meta_intelligence.radar import LeagueRegionMap, MetaRadar, MetaRadarConfig

CUTOFF = datetime(2026, 8, 15, tzinfo=UTC)
REGIONS = LeagueRegionMap((("LCK", "KOREA"), ("LEC", "EMEA")))
CONFIG = MetaRadarConfig(
    cutoff=CUTOFF,
    patch_id="16.14",
    recent_window_days=7,
    prior_window_days=7,
    minimum_recent_matches=4,
    minimum_prior_matches=4,
    minimum_region_matches=2,
    minimum_current_picks=2,
)


def provenance(observed_at: datetime) -> Provenance:
    return Provenance(
        source_id="synthetic-meta-radar-v1",
        source_type="synthetic_pro_match",
        source_uri="fixture://meta-radar-v1",
        source_version="v1",
        retrieved_at=observed_at + timedelta(hours=1),
        content_hash="fixture:meta-radar-v1",
    )


def match(
    match_id: str,
    day: int,
    league: str,
    blue_team: str,
    red_team: str,
) -> MatchRecord:
    observed_at = datetime(2026, 8, day, 12, tzinfo=UTC)
    return MatchRecord(
        match_id=match_id,
        series_id=f"series:{match_id}",
        league=league,
        tournament=f"2026 {league} Summer",
        patch_id="16.14",
        blue_team_id=blue_team,
        red_team_id=red_team,
        winner_team_id=blue_team,
        observed_at=observed_at,
        available_at=observed_at + timedelta(hours=1),
        provenance=provenance(observed_at),
    )


def pick(record: MatchRecord, champion: str, team_id: str, index: int) -> PickBanEvent:
    return PickBanEvent(
        event_id=f"{record.match_id}:{champion}:{index}",
        match_id=record.match_id,
        sequence=index,
        team_id=team_id,
        side=Side.BLUE if team_id == record.blue_team_id else Side.RED,
        action=DraftAction.PICK,
        champion_id=champion,
        role="JUNGLE",
        observed_at=record.observed_at,
        available_at=record.available_at,
        provenance=record.provenance,
    )


def scenario() -> tuple[tuple[MatchRecord, ...], tuple[PickBanEvent, ...]]:
    matches = (
        match("p-kr-1", 4, "LCK", "K1", "K2"),
        match("p-kr-2", 5, "LCK", "K3", "K4"),
        match("p-eu-1", 6, "LEC", "E1", "E2"),
        match("p-eu-2", 7, "LEC", "E3", "E4"),
        match("r-kr-1", 10, "LCK", "K1", "K2"),
        match("r-kr-2", 11, "LCK", "K3", "K4"),
        match("r-eu-1", 12, "LEC", "E1", "E2"),
        match("r-eu-2", 13, "LEC", "E3", "E4"),
    )
    by_id = {record.match_id: record for record in matches}
    events = (
        pick(by_id["r-kr-1"], "RekSai", "K1", 1),
        pick(by_id["r-kr-2"], "RekSai", "K3", 1),
        pick(by_id["p-eu-1"], "Mundo", "E1", 1),
        pick(by_id["r-eu-1"], "Mundo", "E1", 1),
        pick(by_id["r-eu-2"], "Mundo", "E3", 1),
        pick(by_id["p-kr-1"], "Zyra", "K1", 1),
        pick(by_id["p-eu-1"], "Zyra", "E1", 2),
        pick(by_id["r-kr-1"], "Zyra", "K1", 2),
        replace(
            pick(by_id["r-eu-2"], "Karthus", "E3", 2),
            available_at=CUTOFF + timedelta(hours=1),
        ),
    )
    return matches, events


def entries_by_champion(payload) -> dict[str, dict]:
    return {entry["champion_id"]: entry for entry in payload["entries"]}


def test_radar_emits_explainable_deltas_divergence_and_concentration() -> None:
    matches, events = scenario()

    payload = MetaRadar().build(matches, events, CONFIG, REGIONS).to_dict()
    entries = entries_by_champion(payload)
    reksai = entries["RekSai"]

    assert payload["fixture_only"] is True
    assert payload["windows"]["recent"]["match_count"] == 4
    assert payload["windows"]["prior"]["match_count"] == 4
    assert reksai["metrics"] == {
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
    }
    assert reksai["eligible_for_review"] is True
    assert reksai["quality_flags"] == []
    assert len(reksai["evidence_event_ids"]) == 2


def test_radar_has_no_composite_score_and_uses_documented_sort_order() -> None:
    matches, events = scenario()

    payload = MetaRadar().build(matches, events, CONFIG, REGIONS).to_dict()

    assert [entry["champion_id"] for entry in payload["entries"]] == [
        "RekSai",
        "Mundo",
        "Zyra",
    ]
    assert all("score" not in entry for entry in payload["entries"])
    assert payload["entries"][2]["quality_flags"] == ["LOW_CURRENT_PICK_COUNT"]


def test_future_event_is_excluded_and_cannot_create_candidate() -> None:
    matches, events = scenario()

    payload = MetaRadar().build(matches, events, CONFIG, REGIONS).to_dict()

    assert "Karthus" not in entries_by_champion(payload)
    assert payload["quality"]["future_event_count_excluded"] == 1


def test_report_json_is_byte_for_byte_deterministic() -> None:
    matches, events = scenario()
    radar = MetaRadar()

    first = radar.build(matches, events, CONFIG, REGIONS).to_json()
    second = radar.build(matches, events, CONFIG, REGIONS).to_json()

    assert first == second


def test_unmapped_league_is_visible_in_quality_flags() -> None:
    matches, events = scenario()
    unknown_match = match("r-unknown", 14, "NEW", "N1", "N2")
    unknown_pick = pick(unknown_match, "Ivern", "N1", 1)

    payload = (
        MetaRadar()
        .build(
            (*matches, unknown_match),
            (*events, unknown_pick),
            replace(CONFIG, minimum_recent_matches=5, minimum_current_picks=1),
            REGIONS,
        )
        .to_dict()
    )

    assert payload["quality"]["unknown_leagues"] == ["NEW"]
    assert entries_by_champion(payload)["Ivern"]["quality_flags"] == ["UNMAPPED_LEAGUE_EVIDENCE"]


def test_event_must_match_source_match_time_and_team() -> None:
    matches, events = scenario()
    bad = replace(events[0], observed_at=events[0].observed_at + timedelta(minutes=1))

    with pytest.raises(ValueError, match="observed_at mismatch"):
        MetaRadar().build(matches, (bad, *events[1:]), CONFIG, REGIONS)


def test_region_mapping_rejects_duplicate_leagues() -> None:
    with pytest.raises(ValueError, match="unique league"):
        LeagueRegionMap((("LCK", "KOREA"), ("LCK", "OTHER")))


def test_region_mapping_rejects_non_string_values(tmp_path) -> None:
    config = tmp_path / "regions.json"
    config.write_text(
        json.dumps({"schema_version": "1", "leagues": {"LCK": None}}),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="must be strings"):
        LeagueRegionMap.from_json(config)


def test_duplicate_champion_role_in_one_match_is_rejected() -> None:
    matches, events = scenario()
    duplicate = replace(events[0], event_id="duplicate-event")

    with pytest.raises(ValueError, match="at most once per match"):
        MetaRadar().build(matches, (duplicate, *events), CONFIG, REGIONS)
