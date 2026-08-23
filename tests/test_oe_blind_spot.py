from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from pro_meta_intelligence.backtest import OEBlindSpotConfig, benchmark_oe_blind_spots
from pro_meta_intelligence.cli import main
from pro_meta_intelligence.quality import OEHistoryCriteria
from pro_meta_intelligence.radar import LeagueRegionMap
from pro_meta_intelligence.sources import RawSourceArtifact, SnapshotArchive, SourceRegistry

FIXTURES = Path(__file__).parent / "fixtures"
SOURCE_ID = "oracles-elixir-match-data"
SOURCE_URL = "https://drive.usercontent.google.com/download?id=reviewed"
CUTOFF = datetime(2026, 8, 22, 3, 0, tzinfo=UTC)


def _game_rows(
    game_id: str,
    date: str,
    *,
    blue_jungle: str = "Xin Zhao",
    red_jungle: str = "Diana",
) -> bytes:
    base = (FIXTURES / "oracles_elixir_game.csv").read_bytes()
    rows = b"\n".join(base.splitlines()[1:]) + b"\n"
    return (
        rows.replace(b"GAME001", game_id.encode())
        .replace(b"2026-08-20 10:00:00", date.encode())
        .replace(b"Xin Zhao", blue_jungle.encode())
        .replace(b"Diana", red_jungle.encode())
    )


def _build_benchmark_history(
    tmp_path: Path, *, include_blocking_patch_issue: bool = False
) -> SnapshotArchive:
    header = (FIXTURES / "oracles_elixir_game.csv").read_bytes().splitlines()[0] + b"\n"
    initial = header + b"".join(
        (
            _game_rows("PRIOR001", "2026-08-10 10:00:00"),
            _game_rows("PRIOR002", "2026-08-12 10:00:00"),
            _game_rows(
                "RECENT001",
                "2026-08-16 10:00:00",
                blue_jungle="RekSai",
                red_jungle="Wukong",
            ),
            _game_rows(
                "RECENT002",
                "2026-08-17 10:00:00",
                blue_jungle="RekSai",
                red_jungle="Wukong",
            ),
            _game_rows("RECENT003", "2026-08-18 10:00:00"),
            _game_rows("RECENT004", "2026-08-19 10:00:00"),
            _game_rows("RECENT005", "2026-08-20 10:00:00"),
        )
    )
    if include_blocking_patch_issue:
        invalid = _game_rows("INVALID001", "2026-08-13 10:00:00").replace(
            b",100,Blue,team,Blue Team,oe:team:blue,1,,0,",
            b",100,Blue,team,Blue Team,oe:team:blue,0,,0,",
        )
        initial += invalid
    outcome = initial + b"".join(
        (
            _game_rows(
                "FUTURE001",
                "2026-08-24 10:00:00",
                blue_jungle="RekSai",
                red_jungle="Ivern",
            ),
            _game_rows(
                "FUTURE002",
                "2026-08-25 10:00:00",
                blue_jungle="RekSai",
                red_jungle="Ivern",
            ),
        )
    )
    archive = SnapshotArchive(tmp_path)
    for retrieved_at, body in ((CUTOFF, initial), (CUTOFF + timedelta(days=7), outcome)):
        archive.store(
            RawSourceArtifact.create(
                source_id=SOURCE_ID,
                request_url=SOURCE_URL,
                final_url=SOURCE_URL,
                media_type="text/csv",
                retrieved_at=retrieved_at,
                body=body,
            )
        )
    return archive


def _history_criteria() -> OEHistoryCriteria:
    return OEHistoryCriteria(
        minimum_retrievals=2,
        minimum_unique_states=2,
        minimum_collection_span_days=7,
        maximum_gap_hours=168,
        outcome_horizon_days=7,
        minimum_matured_cutoffs=1,
    )


def _benchmark_config() -> OEBlindSpotConfig:
    return OEBlindSpotConfig(
        top_k=2,
        minimum_future_picks=2,
        minimum_future_distinct_teams=1,
        maximum_pre_cutoff_presence=0.5,
        patch_id="16.15",
        minimum_recent_matches=5,
        minimum_prior_matches=2,
        minimum_region_matches=1,
        minimum_current_picks=2,
    )


def test_walk_forward_benchmark_pins_candidates_and_outcomes_to_distinct_states(
    tmp_path,
) -> None:
    archive = _build_benchmark_history(tmp_path)
    report = benchmark_oe_blind_spots(
        archive.inspect(SOURCE_ID),
        SourceRegistry.load_default(),
        source_timezone="UTC",
        history_criteria=_history_criteria(),
        config=_benchmark_config(),
        league_regions=LeagueRegionMap((("LCK", "KOREA"),)),
    ).to_dict()

    assert report["status"] == "COMPLETE"
    assert report["benchmark_ready"] is True
    assert report["history_readiness"]["ready"] is True
    assert report["skipped_cutoffs"] == []
    assert len(report["cutoffs"]) == 1

    cutoff = report["cutoffs"][0]
    assert cutoff["cutoff_content_hash"] != cutoff["outcome_content_hash"]
    assert cutoff["eligible_low_presence_candidate_count"] == 2
    assert all(item["current_pick_presence"] <= 0.5 for item in cutoff["selected_candidates"])
    assert [(item["champion_id"], item["outcome"]) for item in cutoff["selected_candidates"]] == [
        ("RekSai", "HIT"),
        ("Wukong", "FALSE_ALERT"),
    ]
    assert [item["champion_id"] for item in cutoff["actual_adoptions"]] == [
        "Ivern",
        "RekSai",
    ]
    assert [item["type"] for item in cutoff["failure_cases"]] == [
        "MISSED_ADOPTION",
        "FALSE_ALERT",
    ]
    assert cutoff["metrics"] == {
        "recall_at_k": 0.5,
        "precision_at_k": 0.5,
        "false_alert_rate": 0.5,
        "false_alert_count": 1,
        "hit_count": 1,
        "miss_count": 1,
        "target_count": 2,
        "selected_count": 2,
        "median_lead_time_hours": 79.0,
        "review_compression": 6.0,
        "evidence_coverage": 1.0,
    }
    assert report["aggregate"]["micro_recall_at_k"] == 0.5
    assert report["aggregate"]["false_alerts_per_cutoff"] == 1.0


def test_benchmark_fails_closed_before_history_is_mature() -> None:
    report = benchmark_oe_blind_spots(
        SnapshotArchive(Path("missing-blind-spot-history")).inspect(SOURCE_ID),
        SourceRegistry.load_default(),
        source_timezone="UTC",
        history_criteria=_history_criteria(),
        config=_benchmark_config(),
        league_regions=LeagueRegionMap((("LCK", "KOREA"),)),
    ).to_dict()

    assert report["status"] == "HISTORY_NOT_READY"
    assert report["benchmark_ready"] is False
    assert report["cutoffs"] == []
    assert report["history_readiness"]["blocking_reasons"] == ["NO_ARCHIVED_RETRIEVALS"]


def test_benchmark_skips_a_cutoff_with_selected_patch_contract_issues(tmp_path) -> None:
    archive = _build_benchmark_history(tmp_path, include_blocking_patch_issue=True)
    report = benchmark_oe_blind_spots(
        archive.inspect(SOURCE_ID),
        SourceRegistry.load_default(),
        source_timezone="UTC",
        history_criteria=_history_criteria(),
        config=_benchmark_config(),
        league_regions=LeagueRegionMap((("LCK", "KOREA"),)),
    ).to_dict()

    assert report["history_readiness"]["ready"] is True
    assert report["benchmark_ready"] is False
    assert report["status"] == "NO_EVALUABLE_CUTOFFS"
    assert report["cutoffs"] == []
    assert report["skipped_cutoffs"][0]["reason"] == "PATCH_HAS_BLOCKING_IMPORT_ISSUES"
    assert report["skipped_cutoffs"][0]["cutoff_import_quality"]["blocking_issue_game_count"] == 1


def test_benchmark_cli_writes_machine_readable_report(tmp_path) -> None:
    archive = _build_benchmark_history(tmp_path / "archive")
    output = tmp_path / "blind-spot.json"

    exit_code = main(
        [
            "benchmark-oe-history",
            "--archive-dir",
            str(archive.root),
            "--source-timezone",
            "UTC",
            "--minimum-retrievals",
            "2",
            "--minimum-unique-states",
            "2",
            "--minimum-collection-span-days",
            "7",
            "--maximum-gap-hours",
            "168",
            "--outcome-horizon-days",
            "7",
            "--minimum-matured-cutoffs",
            "1",
            "--top-k",
            "2",
            "--minimum-future-picks",
            "2",
            "--minimum-future-distinct-teams",
            "1",
            "--maximum-pre-cutoff-presence",
            "0.5",
            "--patch",
            "16.15",
            "--minimum-recent-matches",
            "5",
            "--minimum-prior-matches",
            "2",
            "--minimum-region-matches",
            "1",
            "--minimum-current-picks",
            "2",
            "--output",
            str(output),
        ]
    )

    assert exit_code == 0
    payload = output.read_text(encoding="utf-8")
    assert '"benchmark_kind": "OE_WALK_FORWARD_BLIND_SPOT"' in payload
    assert '"status": "COMPLETE"' in payload


def test_benchmark_cli_returns_two_and_writes_blockers_when_not_ready(tmp_path) -> None:
    output = tmp_path / "not-ready.json"

    exit_code = main(
        [
            "benchmark-oe-history",
            "--archive-dir",
            str(tmp_path / "missing"),
            "--source-timezone",
            "UTC",
            "--output",
            str(output),
        ]
    )

    assert exit_code == 2
    payload = output.read_text(encoding="utf-8")
    assert '"status": "HISTORY_NOT_READY"' in payload
    assert '"NO_ARCHIVED_RETRIEVALS"' in payload


@pytest.mark.parametrize("value", [-0.1, 1.1])
def test_benchmark_rejects_invalid_presence_threshold(value) -> None:
    with pytest.raises(ValueError, match="between 0 and 1"):
        OEBlindSpotConfig(maximum_pre_cutoff_presence=value)
