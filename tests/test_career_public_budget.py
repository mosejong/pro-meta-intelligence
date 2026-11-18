import json
from datetime import UTC, datetime, timedelta

import pytest

import pro_meta_intelligence.cli as real_cli
from ops import player_career_archive as pca
from ops.player_career_archive import inspect_plan, public_budget_floor
from pro_meta_intelligence.sources import SourceAttemptLedger
from tests.test_fetch_oe_history import NOW

SRC = "oracles-elixir-match-data"


def feed(retrieved_at=NOW, source_id=SRC):
    value = retrieved_at.isoformat() if isinstance(retrieved_at, datetime) else retrieved_at
    return {"input": {"import_report": {"source_id": source_id, "retrieved_at": value}}}


def status(started, finished, network=True, job="SUCCEEDED", source_id=SRC, next_at=None):
    iso = lambda v: v.isoformat() if isinstance(v, datetime) else v  # noqa: E731
    attempt = {"started_at": iso(started), "finished_at": iso(finished), "job_status": job}
    if network != "ABSENT":
        attempt["network_request_performed"] = network
    return {
        "artifact_type": "oe-collection-status",
        "last_attempt": attempt,
        "source": {"source_id": source_id, "next_attempt_at": iso(next_at)},
    }


def floor(f, s, now):
    return public_budget_floor(f, s, now=now)


def test_later_server_success_pushes_retry_past_local_attempt(tmp_path):
    SourceAttemptLedger(tmp_path).record(SRC, "FETCH_PUBLISHED_CSV", NOW)
    server_end = NOW + timedelta(minutes=53)
    budget = floor(
        feed(NOW + timedelta(minutes=50)),
        status(NOW + timedelta(minutes=49), server_end),
        NOW + timedelta(days=1, minutes=10),
    )
    assert not budget["issues"]
    assert budget["floor"] == server_end
    plan, _ = inspect_plan(
        tmp_path, now=NOW + timedelta(days=1, minutes=10), external_budget=budget
    )
    assert not plan["can_attempt_now"]
    assert plan["next_attempt_at"] == (server_end + timedelta(days=1)).isoformat()
    assert plan["public_budget_check"]["status"] == "CHECKED"
    assert "not a distributed lock" in plan["public_budget_check"]["boundary"]
    # Without the external input the pure API keeps its local meaning.
    local, _ = inspect_plan(tmp_path, now=NOW + timedelta(days=1, minutes=10))
    assert local["can_attempt_now"]
    assert "public_budget_check" not in local


@pytest.mark.parametrize("network", [True, None, "ABSENT"])
def test_failed_or_unknown_network_attempt_extends_budget(network):
    end = NOW + timedelta(hours=2)
    budget = floor(feed(NOW), status(NOW + timedelta(hours=1), end, network, "FAILED"), end)
    assert not budget["issues"]
    assert budget["floor"] == end


def test_cache_reuse_does_not_extend_but_keeps_retrieved_floor(tmp_path):
    end = NOW + timedelta(days=3)
    budget = floor(feed(NOW), status(end - timedelta(minutes=1), end, False), end)
    assert not budget["issues"]
    assert budget["floor"] == NOW
    plan, _ = inspect_plan(tmp_path, now=end, external_budget=budget)
    assert plan["can_attempt_now"]
    assert plan["next_attempt_at"] == (NOW + timedelta(days=1)).isoformat()


def test_published_next_attempt_is_respected(tmp_path):
    later = NOW + timedelta(days=5)
    budget = floor(feed(NOW), status(NOW, NOW, False, next_at=later), NOW + timedelta(days=2))
    assert budget["not_before"] == later
    plan, _ = inspect_plan(tmp_path, now=NOW + timedelta(days=2), external_budget=budget)
    assert not plan["can_attempt_now"]
    assert plan["next_attempt_at"] == later.isoformat()


@pytest.mark.parametrize(
    ("f", "s", "code"),
    [
        (feed(NOW + timedelta(days=9)), status(NOW, NOW), "FEED_RETRIEVED_AT_IN_FUTURE"),
        (feed(NOW), status(NOW, NOW + timedelta(days=9)), "STATUS_FINISHED_AT_IN_FUTURE"),
        (feed("2026-11-18T00:00:00"), status(NOW, NOW), "FEED_RETRIEVED_AT_NAIVE_TIMESTAMP"),
        (feed("yesterday"), status(NOW, NOW), "FEED_RETRIEVED_AT_INVALID_TIMESTAMP"),
        (feed(source_id="other"), status(NOW, NOW), "FEED_SOURCE_MISMATCH"),
        (feed(NOW), status(NOW, NOW, source_id="other"), "STATUS_SOURCE_MISMATCH"),
        (feed(NOW), status(NOW, NOW, "true"), "STATUS_NETWORK_FLAG_NOT_BOOLEAN"),
        (feed(NOW), status(NOW, NOW, 0), "STATUS_NETWORK_FLAG_NOT_BOOLEAN"),
        (feed(NOW), status(NOW + timedelta(hours=1), NOW), "STATUS_FINISHED_BEFORE_STARTED"),
        (feed(NOW), status(NOW, None), "STATUS_FINISHED_AT_NOT_TIMESTAMP"),
        ({"input": {}}, status(NOW, NOW), "FEED_IMPORT_REPORT_MISSING"),
        ([], status(NOW, NOW), "FEED_INVALID_SHAPE"),
        (feed(NOW), {"artifact_type": "other"}, "STATUS_ARTIFACT_MISMATCH"),
        (feed(NOW), {**status(NOW, NOW), "last_attempt": None}, "STATUS_LAST_ATTEMPT_MISSING"),
        (feed(NOW), status(NOW, NOW, next_at="soon"), "STATUS_NEXT_ATTEMPT_INVALID_TIMESTAMP"),
    ],
)
def test_bad_public_records_fail_closed(tmp_path, f, s, code):
    now = NOW + timedelta(days=2)
    budget = public_budget_floor(f, s, now=now)
    assert code in budget["issues"]
    plan, _ = inspect_plan(tmp_path, now=now, external_budget=budget)
    assert not plan["can_attempt_now"]
    assert plan["next_attempt_at"] is None
    assert plan["public_budget_check"]["status"] == "BLOCKED"


def test_missing_or_invalid_files_are_not_treated_as_no_attempt(tmp_path):
    (tmp_path / "bad.json").write_text("{not json", encoding="utf-8")
    budget = pca.load_public_budget(tmp_path / "none.json", tmp_path / "bad.json", now=NOW)
    assert "FEED_PUBLIC_RECORD_MISSING" in budget["issues"]
    assert "STATUS_PUBLIC_RECORD_INVALID_JSON" in budget["issues"]
    assert budget["floor"] is None


def write_public(tmp_path, f, s):
    (tmp_path / "feed.json").write_text(json.dumps(f), encoding="utf-8")
    (tmp_path / "status.json").write_text(json.dumps(s), encoding="utf-8")
    return [
        "--public-feed",
        str(tmp_path / "feed.json"),
        "--public-collection-status",
        str(tmp_path / "status.json"),
    ]


@pytest.fixture
def cli_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(real_cli, "main", lambda argv: calls.append(argv) or 0)
    return calls


def archive_args(tmp_path):
    archive = tmp_path / "a"
    archive.mkdir(exist_ok=True)
    return ["--archive-dir", str(archive)]


@pytest.mark.parametrize(
    "records",
    [
        "missing",
        "recent_server",
        "future",
        "source",
        "string_flag",
    ],
)
def test_fetch_next_never_delegates_when_public_check_blocks(tmp_path, cli_calls, records):
    real_now = datetime.now(UTC)
    if records == "missing":
        public = [
            "--public-feed",
            str(tmp_path / "x.json"),
            "--public-collection-status",
            str(tmp_path / "y.json"),
        ]
    else:
        recent = real_now - timedelta(hours=1)
        f, s = feed(recent), status(recent, recent)
        if records == "future":
            f = feed(real_now + timedelta(days=3))
        elif records == "source":
            s = status(recent, recent, source_id="other")
        elif records == "string_flag":
            s = status(recent, recent, "false")
        public = write_public(tmp_path, f, s)
    code = pca.main(["--fetch-next", *archive_args(tmp_path), *public])
    assert code == 3
    assert cli_calls == []


def test_fetch_next_delegates_once_when_public_records_are_old(tmp_path, cli_calls):
    old = datetime.now(UTC) - timedelta(days=3)
    public = write_public(tmp_path, feed(old), status(old, old))
    code = pca.main(["--fetch-next", *archive_args(tmp_path), *public])
    assert code == 0
    assert len(cli_calls) == 1
    assert cli_calls[0][:3] == ["fetch-oe", "--year", "2015"]
    assert "--historical-usage-only" in cli_calls[0]


def test_fetch_next_rechecks_immediately_before_delegation(tmp_path, cli_calls, monkeypatch):
    old = datetime.now(UTC) - timedelta(days=3)
    public = write_public(tmp_path, feed(old), status(old, old))
    original = pca.load_public_budget
    seen = []

    def changing(*a, **k):
        seen.append(1)
        if len(seen) == 2:  # server attempt appears between first check and delegation
            recent = datetime.now(UTC) - timedelta(minutes=1)
            write_public(tmp_path, feed(recent), status(recent, recent))
        return original(*a, **k)

    monkeypatch.setattr(pca, "load_public_budget", changing)
    assert pca.main(["--fetch-next", *archive_args(tmp_path), *public]) == 3
    assert len(seen) == 2
    assert cli_calls == []


def test_explicit_cutoff_plan_ignores_public_records_and_stays_offline(tmp_path, cli_calls, capsys):
    out = tmp_path / "plan.json"
    missing = [
        "--public-feed",
        str(tmp_path / "x.json"),
        "--public-collection-status",
        str(tmp_path / "y.json"),
    ]
    args = ["--cutoff", NOW.isoformat(), "--output", str(out), *archive_args(tmp_path), *missing]
    assert pca.main(args) == 0
    plan = json.loads(out.read_text(encoding="utf-8"))
    assert "public_budget_check" not in plan
    assert plan["can_attempt_now"]
    assert cli_calls == []
    with pytest.raises(SystemExit):
        pca.main(args)  # refuses to overwrite the existing report
    with pytest.raises(SystemExit):
        pca.main(["--fetch-next", "--cutoff", NOW.isoformat(), *archive_args(tmp_path)])
    assert cli_calls == []


def test_live_plan_without_cutoff_reports_blocked_public_check(tmp_path, capsys):
    missing = [
        "--public-feed",
        str(tmp_path / "x.json"),
        "--public-collection-status",
        str(tmp_path / "y.json"),
    ]
    assert pca.main([*archive_args(tmp_path), *missing]) == 0
    plan = json.loads(capsys.readouterr().out)
    assert plan["public_budget_check"]["status"] == "BLOCKED"
    assert not plan["can_attempt_now"]
    assert plan["next_year"] == 2015
