"""Season evidence for the frozen current-draft cohort: 2374 capture only, as of its cutoff."""

import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

import ops.prepare_current_draft_season_evidence as prep
from ops.build_player_season_history import validate_output
from pro_meta_intelligence.opponent.player_season import roster_basis_from_feed
from pro_meta_intelligence.sources import RawSourceArtifact, SnapshotArchive
from tests.test_opponent import FIXTURE, RETRIEVED_AT

SOURCE_ID = "oracles-elixir-match-data"
NOW = datetime(2026, 11, 20, tzinfo=UTC)


def _store(root, body, when=RETRIEVED_AT):
    artifact = RawSourceArtifact.create(
        source_id=SOURCE_ID,
        request_url="https://example.invalid/oe.csv",
        final_url="https://example.invalid/oe.csv",
        media_type="text/csv",
        retrieved_at=when,
        body=body,
    )
    return SnapshotArchive(root).store(artifact)


def _pins(stored, **changes):
    pins = prep.Pins(
        candidate_hash=stored.content_hash,
        candidate_retrieved_at=RETRIEVED_AT,
        season=2026,
        forbidden_hashes=prep.FROZEN.forbidden_hashes,
    )
    return replace(pins, **changes)


def _dataset(content_hash, *, version=None, cutoff=None, profiles=None, target="oe:LCK:TARGET1"):
    version = version or content_hash
    cutoff = cutoff or RETRIEVED_AT.isoformat()
    sources = [{"source_id": SOURCE_ID, "source_version": version, "content_hash": content_hash}]
    if profiles is None:
        profiles = [
            {"player_id": "oe:player:blue-jng", "player_name": "Comet", "role": "JUNGLE"},
            {"player_id": "oe:player:blue-mid", "player_name": "Nova", "role": "MID"},
        ]
    report = {
        "patch_id": "16.15",
        "cutoff": cutoff,
        "fixture_only": False,
        "evidence_index": {"source_versions": sources},
        "opponent_prep": {
            "patch_id": "16.15",
            "cutoff": cutoff,
            "fixture_only": False,
            "evidence_index": {"source_versions": [dict(item) for item in sources]},
            "teams": [
                {"team_id": "oe:team:blue", "team_name": "Blue Team", "player_profiles": profiles}
            ],
        },
    }
    return {
        "schema_version": "1",
        "artifact_type": "draft-historical-dataset",
        "scope": "FIRST_SET_IMMEDIATE_OPPONENT_PICK",
        "fixture_only": False,
        "snapshots": [
            {"id": "s1", "cutoff": cutoff, "source_hash": content_hash, "report": report}
        ],
        "matches": [{"snapshot_id": "s1", "match_id": target}],
    }


def _bytes(dataset):
    return json.dumps(dataset).encode("utf-8")


@pytest.fixture
def env(tmp_path_factory):
    # Short base directory: Windows long tmp paths break archive file names.
    root = tmp_path_factory.mktemp("r")
    stored = _store(root / "a", FIXTURE.read_bytes())
    return {"root": root, "stored": stored, "pins": _pins(stored)}


def _build(env, dataset=None, *, pins=None, stored=None, now=NOW):
    stored = stored or env["stored"]
    dataset = dataset if dataset is not None else _dataset(stored.content_hash)
    return prep.build_season_evidence(
        _bytes(dataset),
        stored.data_path,
        stored.metadata_path,
        pins=pins or env["pins"],
        now=now,
    )


def test_builds_history_from_the_verified_capture_with_the_snapshot_basis(env):
    dataset = _dataset(env["stored"].content_hash)
    evidence = _build(env, dataset)
    assert evidence["artifact_type"] == "current-draft-season-evidence"
    assert evidence["preparer_version"] == "current-draft-season-evidence-v1"
    for claim in (
        "BASE_COHORT_ALREADY_OBSERVED",
        "BASELINE_MISSING_SEASON_HISTORY",
        "EXPLORATORY_INTEGRATION_DIAGNOSTIC",
        "NOT_A_CONFIRMATORY_TRIAL",
        "NO_PUBLISHED_OR_LIVE_HISTORY_FALLBACK",
    ):
        assert claim in evidence["claims"]
    assert evidence["source"] == {
        "source_id": SOURCE_ID,
        "source_version": env["stored"].content_hash,
        "content_hash": env["stored"].content_hash,
        "retrieved_at": RETRIEVED_AT.isoformat(),
    }
    (entry,) = evidence["histories"]
    report = dataset["snapshots"][0]["report"]
    assert entry["snapshot_id"] == "s1"
    assert entry["cutoff"] == report["cutoff"]
    assert entry["roster_basis"] == roster_basis_from_feed(report)
    assert entry["roster_reference_count"] == 2
    history = json.loads(entry["history_json"])
    assert history["cutoff"] == report["cutoff"]
    assert history["season"] == 2026
    validate_output(entry["history_json"], season=2026, basis=roster_basis_from_feed(report))
    players = {item["player_id"]: item for item in history["players"]}
    jungle = players["oe:player:blue-jng"]
    assert jungle["status"] == "FOUND"
    assert jungle["roles"]["JUNGLE"]["season"]["champions"][0]["champion_id"] == "Xin Zhao"
    assert players["oe:player:blue-mid"]["status"] == "FOUND"


def test_future_player_stats_are_not_included(env):
    # Same capture time, but the file also holds a game dated after it: it must not count.
    future = (
        FIXTURE.read_text(encoding="utf-8")
        .replace("GAME001", "GAME002")
        .replace("2026-08-20 10:00:00", "2026-08-23 10:00:00")
        .replace("Xin Zhao", "Lee Sin")
    )
    lines = future.splitlines()[1:]
    body = FIXTURE.read_bytes().rstrip(b"\n") + b"\n" + "\n".join(lines).encode("utf-8") + b"\n"
    stored = _store(env["root"] / "f", body)
    evidence = _build(env, pins=_pins(stored), stored=stored)
    text = evidence["histories"][0]["history_json"]
    assert "Lee Sin" not in text
    players = {item["player_id"]: item for item in json.loads(text)["players"]}
    assert players["oe:player:blue-jng"]["games"] == 1
    assert players["oe:player:blue-jng"]["roles"]["JUNGLE"]["season"]["games"] == 1


@pytest.mark.parametrize(
    ("case", "message"),
    [
        ("pin_hash", "not the pinned 2374 capture"),
        ("forbidden", "forbidden capture"),
        ("pin_time", "retrieval time differs"),
        ("pin_season", "season year differs"),
        ("future_capture", "retrieved in the future"),
        ("snapshot_hash", "snapshot source is not the pinned"),
        ("naive_cutoff", "timezone-aware"),
        ("later_cutoff", "not exactly the 2374 capture retrieval time"),
        ("earlier_cutoff", "not exactly the 2374 capture retrieval time"),
        ("missing_cutoff", "missing timestamp"),
        ("version", "does not cite exactly the verified capture"),
        ("evidence_hash", "does not cite exactly the verified capture"),
        ("no_evidence", "does not cite exactly the verified capture"),
        ("fixture_report", "not real data"),
        ("fixture_dataset", "unsupported prepared draft dataset"),
        ("target_in_source", "target match is present"),
        ("no_player_ids", "MISSING_FIELD: opponent_prep.teams"),
        ("no_prep", "MISSING_FIELD: snapshot.report.opponent_prep"),
        ("duplicate_snapshot", "duplicate snapshot ID"),
    ],
)
def test_malformed_provenance_time_and_year_are_rejected(env, case, message):
    content_hash = env["stored"].content_hash
    dataset = _dataset(content_hash)
    snapshot = dataset["snapshots"][0]
    report = snapshot["report"]
    pins = env["pins"]
    now = NOW
    if case == "pin_hash":
        pins = _pins(env["stored"], candidate_hash="sha256:" + "1" * 64)
    elif case == "forbidden":
        pins = _pins(env["stored"], forbidden_hashes=frozenset({content_hash}))
    elif case == "pin_time":
        pins = _pins(env["stored"], candidate_retrieved_at=RETRIEVED_AT + timedelta(seconds=1))
    elif case == "pin_season":
        pins = _pins(env["stored"], season=2027)
    elif case == "future_capture":
        now = RETRIEVED_AT - timedelta(seconds=1)
    elif case == "snapshot_hash":
        snapshot["source_hash"] = "sha256:" + "2" * 64
    elif case == "naive_cutoff":
        dataset = _dataset(content_hash, cutoff="2026-08-22T03:00:00")
    elif case == "later_cutoff":
        dataset = _dataset(content_hash, cutoff=(RETRIEVED_AT + timedelta(days=1)).isoformat())
    elif case == "earlier_cutoff":
        report["opponent_prep"]["cutoff"] = (RETRIEVED_AT - timedelta(hours=1)).isoformat()
    elif case == "missing_cutoff":
        del snapshot["cutoff"]
    elif case == "version":
        dataset = _dataset(content_hash, version="sha256:" + "3" * 64)
    elif case == "evidence_hash":
        report["evidence_index"]["source_versions"][0]["content_hash"] = "sha256:" + "4" * 64
    elif case == "no_evidence":
        report["evidence_index"]["source_versions"] = []
        report["opponent_prep"]["evidence_index"]["source_versions"] = []
    elif case == "fixture_report":
        report["fixture_only"] = True
    elif case == "fixture_dataset":
        dataset["fixture_only"] = True
    elif case == "target_in_source":
        dataset = _dataset(content_hash, target="oe:LCK:GAME001")
    elif case == "no_player_ids":
        dataset = _dataset(content_hash, profiles=[{"player_name": "Comet", "role": "JUNGLE"}])
    elif case == "no_prep":
        del report["opponent_prep"]
    elif case == "duplicate_snapshot":
        dataset["snapshots"].append(json.loads(json.dumps(snapshot)))
    with pytest.raises(ValueError, match=message):
        _build(env, dataset, pins=pins, now=now)


def test_corrupt_or_mismatched_archive_is_rejected(env):
    stored = env["stored"]
    # Meta for another data file name.
    other = _store(env["root"] / "o", FIXTURE.read_bytes() + b"\n")
    with pytest.raises(ValueError):
        prep.build_season_evidence(
            _bytes(_dataset(stored.content_hash)),
            stored.data_path,
            other.metadata_path,
            pins=env["pins"],
            now=NOW,
        )
    body = stored.data_path.read_bytes()
    stored.data_path.write_bytes(b"X" + body[1:])
    with pytest.raises(ValueError):
        _build(env)


def test_frozen_pins_are_the_2374_capture_and_exclude_outcome_and_2022():
    assert prep.FROZEN.candidate_hash.startswith("sha256:2374ae61")
    assert prep.FROZEN.candidate_retrieved_at.isoformat() == "2026-11-04T03:03:22.056760+00:00"
    assert prep.FROZEN.season == 2026
    assert any(item.startswith("sha256:fcd2e451") for item in prep.FROZEN.forbidden_hashes)
    assert any(item.startswith("sha256:76b7cb8a") for item in prep.FROZEN.forbidden_hashes)


def test_fixture_capture_is_rejected_by_the_frozen_pins(env):
    # The default pins accept only the real 2374 capture; anything else fails closed.
    stored = env["stored"]
    with pytest.raises(ValueError, match="not the pinned 2374 capture"):
        prep.build_season_evidence(
            _bytes(_dataset(stored.content_hash)), stored.data_path, stored.metadata_path, now=NOW
        )


def test_no_live_or_published_fallback(env):
    # Every input is explicit; nothing defaults to published or live history.
    for missing in ("--dataset", "--csv", "--meta", "--output"):
        argv = {
            "--dataset": "d.json",
            "--csv": "c.csv",
            "--meta": "m.json",
            "--output": "outputs/x.json",
        }
        del argv[missing]
        with pytest.raises(SystemExit) as raised:
            prep.main([part for pair in argv.items() for part in pair])
        assert raised.value.code == 2
    source = Path(prep.__file__).read_text(encoding="utf-8")
    for forbidden in ("web/public", "public/history", "DEFAULT_", "build_from_archive", "urlopen"):
        assert forbidden not in source


def test_output_must_be_under_ignored_outputs(env, tmp_path):
    stored = env["stored"]
    dataset_path = env["root"] / "dataset.json"
    dataset_path.write_bytes(_bytes(_dataset(stored.content_hash)))
    with pytest.raises(ValueError, match="under ignored outputs"):
        prep.main(
            [
                "--dataset",
                str(dataset_path),
                "--csv",
                str(stored.data_path),
                "--meta",
                str(stored.metadata_path),
                "--output",
                str(tmp_path / "evidence.json"),
            ]
        )
    assert not (tmp_path / "evidence.json").exists()
