import json
from datetime import datetime

import pytest
from test_pregame_history_support import HISTORY, RETRIEVED, TARGET, write_csv

import ops.audit_pregame_history_support as hs
import ops.benchmark_supported_history_cohort as sc
from ops.benchmark_match_baselines import DEFAULT_CONFIG, clean_records, simulate, summarize

# In the default fixture the 6th history game, GAME001 and the future game have >= 5 priors.
SUPPORTED_SUFFIXES = (":GAMEH6", ":GAME001", ":GAMEF1")


def import_matches(source):
    from pro_meta_intelligence.ingestion.oracles_elixir import OracleElixirCSVAdapter
    from pro_meta_intelligence.sources import SourceRegistry

    return tuple(
        OracleElixirCSVAdapter(SourceRegistry.load_default())
        .import_file(
            source,
            retrieved_at=datetime.fromisoformat("2026-11-19T00:00:00+00:00"),
            source_timezone="UTC",
        )
        .matches
    )


def run_cli(source, digest, output, retrieved=RETRIEVED):
    args = ["--input", str(source), "--retrieved-at", retrieved]
    return sc.main([*args, "--content-hash", digest, "--output", str(output)])


def report_for(tmp_path, **kwargs):
    source, digest = write_csv(tmp_path, **kwargs)
    output = tmp_path / "out" / "cohort.json"
    assert run_cli(source, digest, output) == 0
    return json.loads(output.read_text(encoding="utf-8"))


def test_partitions_match_full_timeline_reference(tmp_path):
    source, digest = write_csv(tmp_path)
    before = source.read_bytes()
    output = tmp_path / "cohort.json"
    assert run_cli(source, f"sha256:{digest.upper()}", output) == 0
    assert source.read_bytes() == before
    report = json.loads(output.read_text(encoding="utf-8"))

    games, _ = clean_records(import_matches(source), DEFAULT_CONFIG, expected_hash=digest)
    full = simulate(games, DEFAULT_CONFIG)
    supported = [p for p in full if p.match_id.endswith(SUPPORTED_SUFFIXES)]
    rest = [p for p in full if not p.match_id.endswith(SUPPORTED_SUFFIXES)]
    assert len(supported) == 3 and len(rest) == 5

    assert report["status"] == "EVALUATED"
    assert set(sc.CLAIMS) <= set(report["claims"])
    assert report["source"]["source_hash_sha256"] == digest
    assert report["partition_check"] == {
        "all": 8,
        "supported": 3,
        "not_supported": 5,
        "disjoint": True,
        "union_equals_all": True,
    }
    parts = report["partitions"]
    assert parts["all"]["cohorts"] == summarize(full)
    assert parts["supported"]["cohorts"] == summarize(supported)
    assert parts["not_supported"]["cohorts"] == summarize(rest)
    assert parts["supported"]["status"] == sc.STATUS_SCORED

    # Refitting on only the supported games would change team Elo; the report must not do that.
    refit = simulate([g for g in games if g.match_id.endswith(SUPPORTED_SUFFIXES)])
    refit_elo = summarize(refit)["all_targets"]["overall"]["team_elo"]
    reported_elo = parts["supported"]["cohorts"]["all_targets"]["overall"]["team_elo"]
    assert refit_elo != reported_elo


def test_no_supported_game_is_explicitly_empty(tmp_path):
    report = report_for(tmp_path, games=(*HISTORY[:3], TARGET))
    assert report["partition_check"]["all"] == 4
    assert report["partition_check"]["supported"] == 0
    empty = report["partitions"]["supported"]
    assert empty["status"] == sc.STATUS_EMPTY
    assert empty["sample_size"] == 0
    scores = empty["cohorts"]["all_targets"]["overall"]["team_elo"]
    assert scores["n"] == 0 and scores["brier"] is None and scores["logloss"] is None


def test_no_targets_is_explicit(tmp_path):
    games = tuple((g, d.replace("2026-07-", "2026-03-")) for g, d in HISTORY)
    report = report_for(tmp_path, games=games)
    assert report["status"] == "NO_EVALUATION_TARGETS"
    assert {p["status"] for p in report["partitions"].values()} == {sc.STATUS_EMPTY}


def test_auditor_dict_unchanged_by_helper(tmp_path):
    source, digest = write_csv(tmp_path)
    raw, matches = source.read_bytes(), import_matches(source)
    report, ids = hs.assess_support_with_ids(raw, matches, expected_hash=digest)
    assert hs.assess_support(raw, matches, expected_hash=digest) == report
    assert len(ids) == report["overall"]["games_all_10_all_metrics_raw_mean_valid"] == 3


def test_report_has_no_ids_values_or_probabilities(tmp_path):
    source, digest = write_csv(tmp_path)
    output = tmp_path / "cohort.json"
    run_cli(source, digest, output)
    text = output.read_text(encoding="utf-8")
    for leak in ("oe:player", "oe:team", "GAME", "Atlas", "Blue Team", "12345.5"):
        assert leak not in text
    forbidden = {"match_id", "player_id", "team_id", "mean_raw", "probabilities", "blue_won"}

    def check_keys(node):
        if isinstance(node, dict):
            assert not forbidden.intersection(node)
            for value in node.values():
                check_keys(value)
        elif isinstance(node, list):
            for value in node:
                check_keys(value)

    check_keys(json.loads(text))


@pytest.mark.parametrize(
    "relative", ["web/public/x.json", "nested/web/dist/x.json", "report.csv", "snapshot.csv"]
)
def test_output_path_refusals(tmp_path, relative):
    source, digest = write_csv(tmp_path)
    with pytest.raises(SystemExit):
        run_cli(source, digest, tmp_path / relative)


def test_input_refusals(tmp_path):
    source, digest = write_csv(tmp_path)
    existing = tmp_path / "existing.json"
    existing.write_text("{}", encoding="utf-8")
    with pytest.raises(SystemExit):
        run_cli(source, digest, existing)
    assert existing.read_text(encoding="utf-8") == "{}"
    with pytest.raises(SystemExit):
        run_cli(source, "0" * 64, tmp_path / "a.json")
    with pytest.raises(SystemExit):
        run_cli(source, digest, tmp_path / "b.json", retrieved="2026-11-19T00:00:00")
    assert not any((tmp_path / name).exists() for name in ("a.json", "b.json"))
