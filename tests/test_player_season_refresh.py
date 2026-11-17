"""Automatic season history refresh from exactly the accepted feed's archived source."""

import json
from datetime import UTC, datetime, timedelta

import pytest

import ops.build_player_season_history as builder
from pro_meta_intelligence.sources import RawSourceArtifact, SnapshotArchive
from tests.test_opponent import FIXTURE, RETRIEVED_AT

SOURCE_ID = "oracles-elixir-match-data"
NOW = datetime(2026, 11, 17, tzinfo=UTC)
NEWER = RETRIEVED_AT + timedelta(hours=12)


def _store(root, body, when):
    artifact = RawSourceArtifact.create(
        source_id=SOURCE_ID,
        request_url="https://example.invalid/oe.csv",
        final_url="https://example.invalid/oe.csv",
        media_type="text/csv",
        retrieved_at=when,
        body=body,
    )
    return SnapshotArchive(root).store(artifact)


@pytest.fixture
def env(tmp_path_factory):
    # Short base directory: Windows long tmp paths break archive file names.
    root = tmp_path_factory.mktemp("r")
    archive = root / "a"
    accepted = _store(archive, FIXTURE.read_bytes(), RETRIEVED_AT)
    # A newer different snapshot and a later re-retrieval of the same bytes must never be used.
    newer = _store(archive, FIXTURE.read_bytes() + b"\n", NEWER)
    _store(archive, FIXTURE.read_bytes(), NEWER)
    feed_path = root / "feed.json"
    feed = _feed(accepted.content_hash, RETRIEVED_AT)
    feed_path.write_text(json.dumps(feed), encoding="utf-8")
    return {
        "root": root,
        "archive": archive,
        "accepted": accepted,
        "newer": newer,
        "feed_path": feed_path,
        "feed": feed,
        "output": root / "out" / "player-season-2026.json",
    }


def _feed(content_hash, retrieved_at, *, version=None, cutoff=None):
    version = version or content_hash
    return {
        "patch_id": "16.15",
        "cutoff": (cutoff or RETRIEVED_AT + timedelta(days=1)).isoformat(),
        "fixture_only": False,
        "input": {
            "import_report": {
                "source_id": SOURCE_ID,
                "source_version": version,
                "content_hash": content_hash,
                "retrieved_at": retrieved_at.isoformat(),
            }
        },
        "evidence_index": {
            "source_versions": [
                {"source_id": SOURCE_ID, "source_version": version, "content_hash": content_hash}
            ]
        },
        "opponent_prep": {
            "teams": [
                {
                    "team_id": "oe:team:blue",
                    "team_name": "Blue Team",
                    "player_profiles": [
                        {"player_id": "oe:player:blue-jng", "player_name": "Comet"}
                    ],
                }
            ]
        },
    }


def _run(env, feed=None, *, now=NOW):
    if feed is not None:
        env["feed_path"].write_text(json.dumps(feed), encoding="utf-8")
    return builder.build_from_archive(
        env["archive"], env["feed_path"], env["output"], season=2026, now=now
    )


def _publish_accepted(env):
    result = _run(env)
    assert result["status"] == "BUILT" and result["found"] == 1
    return env["output"].read_bytes()


def _assert_preserved(env, previous):
    assert env["output"].read_bytes() == previous
    assert not list(env["output"].parent.glob(".player-season-*"))


def test_uses_exactly_the_accepted_snapshot_not_newer_or_rejected(env):
    _publish_accepted(env)
    written = json.loads(env["output"].read_text(encoding="utf-8"))
    assert written["source"] == {
        "source_id": SOURCE_ID,
        "source_version": env["accepted"].content_hash,
        "content_hash": env["accepted"].content_hash,
        "retrieved_at": RETRIEVED_AT.isoformat(),
    }
    assert written["source"]["content_hash"] != env["newer"].content_hash
    selected = builder.select_accepted_snapshot(env["feed"], env["archive"], now=NOW)
    assert selected.data_path == env["accepted"].data_path
    assert selected.metadata_path == env["accepted"].metadata_path


@pytest.mark.parametrize(
    ("case", "message"),
    [
        ("newer_hash", "not found exactly once"),
        ("other_time", "not found exactly once"),
        ("version", "source version"),
        ("evidence", "evidence index"),
        ("future", "future"),
        ("wrong_source", "not the OE match data source"),
    ],
)
def test_feed_basis_mismatches_are_rejected_and_preserve_output(env, case, message):
    previous = _publish_accepted(env)
    accepted_hash = env["accepted"].content_hash
    feed = _feed(accepted_hash, RETRIEVED_AT)
    now = NOW
    if case == "newer_hash":
        feed = _feed(env["newer"].content_hash, RETRIEVED_AT)
    elif case == "other_time":
        feed = _feed(accepted_hash, RETRIEVED_AT + timedelta(minutes=1))
    elif case == "version":
        feed = _feed(accepted_hash, RETRIEVED_AT, version="sha256:" + "1" * 64)
    elif case == "evidence":
        feed["evidence_index"]["source_versions"][0]["content_hash"] = env["newer"].content_hash
    elif case == "future":
        now = RETRIEVED_AT - timedelta(seconds=1)
    elif case == "wrong_source":
        feed["input"]["import_report"]["source_id"] = "other-source"
    with pytest.raises(ValueError, match=message):
        _run(env, feed, now=now)
    _assert_preserved(env, previous)


def test_missing_and_corrupt_archive_are_rejected(env):
    previous = _publish_accepted(env)
    empty = env["root"] / "empty"
    empty.mkdir()
    with pytest.raises(ValueError, match="not found exactly once"):
        builder.build_from_archive(empty, env["feed_path"], env["output"], season=2026, now=NOW)
    _assert_preserved(env, previous)

    # Any corruption, even of an unrelated snapshot, fails closed.
    body = env["newer"].data_path.read_bytes()
    env["newer"].data_path.write_bytes(b"X" + body[1:])
    with pytest.raises(ValueError, match="archive integrity issues: CONTENT_HASH_MISMATCH"):
        _run(env)
    _assert_preserved(env, previous)

    env["newer"].data_path.unlink()
    with pytest.raises(ValueError, match="archive integrity issues: MISSING_DATA_FILE"):
        _run(env)
    _assert_preserved(env, previous)


def test_automatic_refresh_never_moves_cutoff_or_source_backwards(env):
    later_cutoff = RETRIEVED_AT + timedelta(days=2)
    _run(env, _feed(env["accepted"].content_hash, RETRIEVED_AT, cutoff=later_cutoff))
    previous = env["output"].read_bytes()
    with pytest.raises(ValueError, match="cutoff is older"):
        _run(env, _feed(env["accepted"].content_hash, RETRIEVED_AT))
    _assert_preserved(env, previous)

    published = json.loads(previous)
    published["cutoff"] = RETRIEVED_AT.isoformat()
    published["source"]["retrieved_at"] = (RETRIEVED_AT + timedelta(hours=1)).isoformat()
    env["output"].write_text(json.dumps(published), encoding="utf-8")
    previous = env["output"].read_bytes()
    with pytest.raises(ValueError, match="source is older"):
        _run(env, _feed(env["accepted"].content_hash, RETRIEVED_AT))
    _assert_preserved(env, previous)


def test_replace_failure_keeps_previous_output_and_cleans_temp(env, monkeypatch):
    previous = _publish_accepted(env)

    def fail_replace(*_args, **_kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(builder.os, "replace", fail_replace)
    with pytest.raises(OSError, match="disk full"):
        _run(env)
    _assert_preserved(env, previous)


def test_cli_rejects_archive_dir_with_manual_csv(env):
    with pytest.raises(SystemExit) as raised:
        builder.main(
            [
                "--archive-dir",
                str(env["archive"]),
                "--csv",
                str(env["accepted"].data_path),
                "--feed",
                str(env["feed_path"]),
                "--output",
                str(env["output"]),
            ]
        )
    assert raised.value.code == 2
    assert not env["output"].exists()
