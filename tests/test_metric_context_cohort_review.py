"""Independent baseline preservation check while Claude owns the unfinished CLI."""

import json
from datetime import datetime

from test_pregame_history_support import write_csv

import ops.benchmark_metric_context_cohort as context
from ops.benchmark_match_baselines import DEFAULT_CONFIG, clean_records, simulate, summarize
from pro_meta_intelligence.ingestion.oracles_elixir import OracleElixirCSVAdapter
from pro_meta_intelligence.sources import SourceRegistry


def test_insufficient_peer_reference_keeps_every_existing_baseline_prediction(
    tmp_path, monkeypatch
):
    # This fixture has enough history for later targets, but just one other player per role.
    # Five peers are required, so none of its targets can silently become supported.
    source, digest = write_csv(tmp_path)
    raw = source.read_bytes()
    imported = OracleElixirCSVAdapter(SourceRegistry.load_default()).import_file(
        source,
        retrieved_at=datetime.fromisoformat("2026-11-19T00:00:00+00:00"),
        source_timezone="UTC",
    )
    games, _ = clean_records(imported.matches, DEFAULT_CONFIG, expected_hash=digest)
    reference = summarize(simulate(games, DEFAULT_CONFIG), DEFAULT_CONFIG)
    calls = []

    def observe_full_timeline(actual, config):
        calls.append(tuple(m.match_id for m in actual))
        return simulate(actual, config)

    monkeypatch.setattr(context, "simulate", observe_full_timeline)
    report = context.assess_context_cohort(raw, imported.matches, expected_hash=digest)
    assert calls == [tuple(m.match_id for m in games)]
    assert report["partition_check"]["supported"] == 0
    assert report["partition_check"]["not_supported"] == report["partition_check"]["all"]
    assert report["partitions"]["all"]["cohorts"] == reference
    assert report["partitions"]["not_supported"]["cohorts"] == reference
    empty = report["partitions"]["supported"]["cohorts"]["all_targets"]["overall"]["team_elo"]
    assert empty["n"] == 0 and empty["brier"] is None and empty["logloss"] is None
    assert source.read_bytes() == raw
    encoded = json.dumps(report)
    for record in imported.matches:
        for identifier in (record.match_id, record.blue_team_id, record.red_team_id):
            assert identifier not in encoded
    assert '"mean_raw"' not in encoded
    assert '"position_fraction"' not in encoded
    assert '"probabilities"' not in encoded
