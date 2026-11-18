"""Schedule request-attempt budget survives runners; every network and GitHub call is faked."""

from __future__ import annotations

import io
import json
import os
import re
import shutil
import subprocess
import zipfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from ops import schedule_attempt_state as sas
from pro_meta_intelligence.cli import main as cli_main
from pro_meta_intelligence.ingestion.http import HttpResponse, HttpTransportError
from pro_meta_intelligence.ingestion.lolesports_schedule import (
    LoLEsportsScheduleAdapter,
    ScheduleFetchIntervalError,
)
from pro_meta_intelligence.sources import SourceAttemptLedger, SourcePolicyError, SourceRegistry
from pro_meta_intelligence.sources.artifacts import ATTEMPT_LEDGER_FILENAME

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "schedule-refresh.yml"
EMPTY_PAGE = (Path(__file__).parent / "fixtures" / "lolesports_schedule_empty.html").read_bytes()
REPO = "owner/pro-meta-intelligence"
SRC = sas.SOURCE_ID
OP = sas.OPERATION
# run 44421845912 requested at 08:34 KST (23:34Z) and failed later in the Pages test
FAILED_RUN_ID = 44421845912
FAILED_RUN_DONE = datetime(2026, 11, 18, 23, 41, tzinfo=UTC)
NOW = datetime(2026, 11, 19, 2, 0, tzinfo=UTC)  # < 6h after the 08:34 KST request


# --- fakes ----------------------------------------------------------------------------------


class FakeTransport:
    def __init__(self, clock, *, error: Exception | None = None) -> None:
        self.clock = clock
        self.error = error
        self.calls: list[str] = []

    def fetch(self, url: str, *, maximum_bytes: int, user_agent: str) -> HttpResponse:
        self.calls.append(url)
        if self.error is not None:
            raise self.error
        return HttpResponse(url, url, 200, "text/html", EMPTY_PAGE, self.clock())


class FakeApi:
    def __init__(self, runs: list[dict], artifacts=None, zips=None, fail: str | None = None):
        self.runs = runs
        self.artifacts = artifacts or {}
        self.zips = zips or {}
        self.fail = fail
        self.paths: list[str] = []

    def get_json(self, path: str):
        self.paths.append(path)
        if self.fail and self.fail in path:
            raise sas.AttemptStateError("GitHub API request failed")
        if "/actions/workflows/" in path:
            return {"total_count": len(self.runs), "workflow_runs": self.runs}
        run_id = int(re.search(r"/runs/(\d+)/artifacts", path).group(1))
        return {"artifacts": self.artifacts.get(run_id, [])}

    def download(self, path: str, destination: Path, maximum_bytes: int) -> None:
        self.paths.append(path)
        artifact_id = int(re.search(r"/artifacts/(\d+)/zip", path).group(1))
        destination.write_bytes(self.zips[artifact_id])


def run(
    run_id: int,
    *,
    created: datetime,
    updated: datetime,
    status: str = "completed",
    branch: str = "main",
    path: str = sas.WORKFLOW_PATH,
    event: str = "schedule",
    head_repo: str = REPO,
) -> dict:
    return {
        "id": run_id,
        "path": path,
        "head_branch": branch,
        "event": event,
        "status": status,
        "created_at": created.isoformat().replace("+00:00", "Z"),
        "updated_at": updated.isoformat().replace("+00:00", "Z"),
        "run_started_at": created.isoformat().replace("+00:00", "Z"),
        "repository": {"full_name": REPO},
        "head_repository": {"full_name": head_repo},
    }


def artifact(artifact_id: int, run_id: int, *, branch: str = "main", expired=False) -> dict:
    return {
        "id": artifact_id,
        "name": sas.STATE_ARTIFACT_NAME,
        "expired": expired,
        "workflow_run": {"id": run_id, "head_branch": branch},
    }


def identity(run_id: int = 50_000_000_000, attempt: int = 1) -> sas.RunIdentity:
    return sas.RunIdentity(repository=REPO, run_id=run_id, run_attempt=attempt)


def do_restore(tmp: Path, api: FakeApi, now: datetime = NOW, ident=None) -> dict:
    return sas.restore(
        api=api,
        identity=ident or identity(),
        archive_dir=tmp / "raw",
        candidate_dir=tmp / "previous",
        work_dir=tmp / "download",
        now=now,
    )


def fetch_schedule(tmp: Path, monkeypatch, now: datetime, *, error=None, registry=None, extra=()):
    """Run the real CLI + real adapter with a fake transport; returns (exit, transport)."""

    transport = FakeTransport(lambda: now, error=error)

    def build(registry_obj):
        return LoLEsportsScheduleAdapter(registry_obj, transport=transport, clock=lambda: now)

    monkeypatch.setattr("pro_meta_intelligence.cli.LoLEsportsScheduleAdapter", build)
    arguments = [
        "fetch-schedule",
        "--league",
        "lck",
        "--archive-dir",
        str(tmp / "raw"),
        "--output",
        str(tmp / "feed" / "schedule.json"),
        "--changes-output",
        str(tmp / "feed" / "schedule-changes.json"),
        "--diagnostics-dir",
        str(tmp / "diagnostics"),
        *extra,
    ]
    if registry is not None:
        arguments += ["--registry", str(registry)]
    (tmp / "feed").mkdir(parents=True, exist_ok=True)
    return cli_main(arguments), transport


def do_pack(tmp: Path, ident, status: int, now: datetime) -> Path:
    out = tmp / f"upload-{ident.run_id}-{ident.run_attempt}"
    sas.pack(
        identity=ident,
        archive_dir=tmp / "raw",
        output_dir=out,
        fetch_status=status,
        schedule=tmp / "feed" / "schedule.json",
        changes=tmp / "feed" / "schedule-changes.json",
        diagnostics_dir=tmp / "diagnostics",
        previous_candidate_dir=tmp / "previous",
        now=now,
    )
    return out


def zip_dir(directory: Path) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(directory.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(directory).as_posix())
    return buffer.getvalue()


def ledger_time(tmp: Path) -> datetime | None:
    return SourceAttemptLedger(tmp / "raw").latest_attempted_at(SRC, OP)


def failed_run() -> dict:
    return run(
        FAILED_RUN_ID, created=FAILED_RUN_DONE - timedelta(minutes=24), updated=FAILED_RUN_DONE
    )


# --- bootstrap ------------------------------------------------------------------------------


def test_bootstrap_spends_budget_for_the_0834_run_and_blocks_a_new_request(
    tmp_path, monkeypatch, capsys
) -> None:
    older = run(
        1,
        created=FAILED_RUN_DONE - timedelta(hours=8),
        updated=FAILED_RUN_DONE - timedelta(hours=8),
    )
    report = do_restore(tmp_path, FakeApi([older, failed_run()]))

    assert report["status"] == "BOOTSTRAPPED_FROM_RUN_BOUNDS"
    assert report["network_collection_performed"] is False
    assert report["effective_last_attempted_at"] == FAILED_RUN_DONE.isoformat()
    assert {item["network_performed"] for item in report["run_upper_bounds"]} == {"UNKNOWN"}
    assert ledger_time(tmp_path) == FAILED_RUN_DONE

    code, transport = fetch_schedule(tmp_path, monkeypatch, NOW)
    assert code == 3 and transport.calls == []
    result = json.loads(capsys.readouterr().out)
    assert result["status"] == "RATE_LIMITED"
    assert result["retry_at"] == (FAILED_RUN_DONE + timedelta(hours=6)).isoformat()
    # only the schedule ledger is touched; no other source (e.g. Oracle's Elixir) state appears
    assert [path.name for path in (tmp_path / "raw").iterdir()] == [SRC]


@pytest.mark.parametrize(
    "runs",
    [
        [],
        [run(2, created=NOW - timedelta(hours=3), updated=NOW - timedelta(hours=2), branch="dev")],
        [
            run(
                3,
                created=NOW - timedelta(hours=3),
                updated=NOW - timedelta(hours=2),
                path=".github/workflows/x.yml",
            )
        ],
        [
            run(
                4,
                created=NOW - timedelta(hours=3),
                updated=NOW - timedelta(hours=2),
                head_repo="fork/repo",
            )
        ],
        [run(5, created=NOW - timedelta(hours=3), updated=NOW, status="queued")],
    ],
)
def test_no_trusted_evidence_is_never_a_fresh_start(tmp_path, runs) -> None:
    with pytest.raises(sas.AttemptStateError, match="fresh start is not permitted"):
        do_restore(tmp_path, FakeApi(runs))
    assert ledger_time(tmp_path) is None


@pytest.mark.parametrize("fail", ["/actions/workflows/", "/artifacts"])
def test_github_access_failure_is_not_an_empty_state(tmp_path, fail, capsys) -> None:
    api = FakeApi([failed_run()], fail=fail)
    code = sas.main(
        [
            "restore",
            "--repository",
            REPO,
            "--run-id",
            "50000000000",
            "--run-attempt",
            "1",
            "--archive-dir",
            str(tmp_path / "raw"),
            "--candidate-dir",
            str(tmp_path / "previous"),
            "--work-dir",
            str(tmp_path / "download"),
        ],
        api=api,
        clock=lambda: NOW,
    )
    assert code == 2
    assert json.loads(capsys.readouterr().out)["status"] == "ATTEMPT_STATE_BLOCKED"
    assert ledger_time(tmp_path) is None


@pytest.mark.parametrize("field", ["updated_at", "created_at"])
def test_future_or_unreadable_run_times_block_collection(tmp_path, field) -> None:
    future = failed_run()
    future["updated_at"] = (NOW + timedelta(hours=1)).isoformat()
    unreadable = failed_run()
    unreadable[field] = "yesterday"
    with pytest.raises(sas.AttemptStateError, match="future"):
        do_restore(tmp_path, FakeApi([future]))
    with pytest.raises(sas.AttemptStateError):
        do_restore(tmp_path, FakeApi([unreadable]))
    assert ledger_time(tmp_path) is None


def test_another_run_in_progress_blocks(tmp_path) -> None:
    busy = run(7, created=NOW - timedelta(minutes=5), updated=NOW, status="in_progress")
    with pytest.raises(sas.AttemptStateError, match="in progress"):
        do_restore(tmp_path, FakeApi([busy, failed_run()]))


def test_gh_cli_failure_raises_instead_of_returning_nothing() -> None:
    def runner(*args, **kwargs):
        return subprocess.CompletedProcess(args, 1, b"", b"HTTP 403")

    with pytest.raises(sas.AttemptStateError, match="failed"):
        sas.GhCliApi(runner).get_json("repos/x/y/actions/workflows/f.yml/runs")


# --- full cycle ------------------------------------------------------------------------------


def first_cycle(tmp: Path, monkeypatch, *, error=None) -> tuple[int, int, bytes, datetime]:
    """Bootstrap, perform one allowed request at `fetch_at`, pack state; returns zip bytes."""

    fetch_at = FAILED_RUN_DONE + timedelta(hours=8)
    run_a = tmp / "run-a"
    do_restore(run_a, FakeApi([failed_run()]), now=fetch_at, ident=identity(60))
    code, transport = fetch_schedule(run_a, monkeypatch, fetch_at, error=error)
    assert len(transport.calls) == 1
    assert ledger_time(run_a) == fetch_at
    state = do_pack(run_a, identity(60), code, fetch_at + timedelta(minutes=1))
    return code, len(transport.calls), zip_dir(state), fetch_at


def test_success_then_failed_deploy_restores_and_sends_zero_requests_within_6h(
    tmp_path, monkeypatch, capsys
) -> None:
    code, _, state_zip, fetch_at = first_cycle(tmp_path, monkeypatch)
    assert code == 0
    # run 60 failed afterwards (Pages test/deploy): its state artifact already exists
    runs = [
        run(60, created=fetch_at - timedelta(minutes=2), updated=fetch_at + timedelta(minutes=9)),
        failed_run(),
    ]
    api = FakeApi(runs, {60: [artifact(900, 60)]}, {900: state_zip})
    run_b = tmp_path / "run-b"
    later = fetch_at + timedelta(hours=5, minutes=59)
    report = do_restore(run_b, api, now=later, ident=identity(61))

    assert report["status"] == "RESTORED" and report["restored_from_run_id"] == 60
    assert report["run_upper_bounds"] == []
    assert report["candidate"]["status"] == "VERIFIED_AND_RETAINED_ONLY"
    assert report["candidate"]["retrieved_at"] == fetch_at.isoformat()
    capsys.readouterr()
    code, transport = fetch_schedule(run_b, monkeypatch, later)
    assert code == 3 and transport.calls == []
    # the cooldown run neither rewrites the budget nor builds a candidate of its own
    assert ledger_time(run_b) == fetch_at
    assert not (run_b / "feed" / "schedule.json").exists()

    cooldown_state = do_pack(run_b, identity(61), 3, later)
    manifest = json.loads((cooldown_state / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["ledger_latest_attempted_at"] == fetch_at.isoformat()
    assert manifest["candidate_origin"] == "CARRIED_FORWARD_FROM_RESTORED_STATE"
    assert manifest["candidate_retrieved_at"] == fetch_at.isoformat()

    # after the interval exactly one request is sent and recorded
    run_c = tmp_path / "run-c"
    api_c = FakeApi(
        [run(61, created=later, updated=later + timedelta(minutes=3)), *runs],
        {61: [artifact(901, 61)], 60: [artifact(900, 60)]},
        {901: zip_dir(cooldown_state), 900: state_zip},
    )
    allowed = fetch_at + timedelta(hours=6, minutes=1)
    do_restore(run_c, api_c, now=allowed, ident=identity(62))
    code, transport = fetch_schedule(run_c, monkeypatch, allowed)
    assert code == 0 and len(transport.calls) == 1
    assert ledger_time(run_c) == allowed


def test_source_failure_keeps_the_spent_budget(tmp_path, monkeypatch, capsys) -> None:
    code, calls, state_zip, fetch_at = first_cycle(
        tmp_path, monkeypatch, error=HttpTransportError("schedule source returned HTTP 503")
    )
    assert (code, calls) == (4, 1)
    result = json.loads(capsys.readouterr().out)
    assert result["request_attempt_recorded_at"] == fetch_at.isoformat()

    runs = [run(60, created=fetch_at, updated=fetch_at + timedelta(minutes=2)), failed_run()]
    run_b = tmp_path / "run-b"
    do_restore(
        run_b,
        FakeApi(runs, {60: [artifact(900, 60)]}, {900: state_zip}),
        now=fetch_at + timedelta(hours=2),
        ident=identity(61),
    )
    code, transport = fetch_schedule(run_b, monkeypatch, fetch_at + timedelta(hours=2))
    assert code == 3 and transport.calls == []


def test_newer_run_without_state_and_rerun_attempt_are_both_counted(tmp_path, monkeypatch) -> None:
    _, _, state_zip, fetch_at = first_cycle(tmp_path, monkeypatch)
    lost_upload = run(
        61, created=fetch_at + timedelta(hours=7), updated=fetch_at + timedelta(hours=7, minutes=5)
    )
    runs = [lost_upload, run(60, created=fetch_at, updated=fetch_at + timedelta(minutes=9))]
    api = FakeApi(runs, {60: [artifact(900, 60)]}, {900: state_zip})
    report = do_restore(tmp_path / "b", api, now=fetch_at + timedelta(hours=8), ident=identity(62))
    assert report["restored_ledger_attempted_at"] == fetch_at.isoformat()
    assert report["effective_last_attempted_at"] == lost_upload["updated_at"].replace("Z", "+00:00")

    # a re-run of run 62 must count its earlier attempt even without its own artifact
    current = run(62, created=fetch_at + timedelta(hours=8), updated=NOW, status="in_progress")
    current["run_started_at"] = (fetch_at + timedelta(hours=8, minutes=30)).isoformat()
    report = do_restore(
        tmp_path / "c",
        FakeApi([current, *runs], {60: [artifact(900, 60)]}, {900: state_zip}),
        now=fetch_at + timedelta(hours=9),
        ident=identity(62, attempt=2),
    )
    assert report["effective_last_attempted_at"] == current["run_started_at"]


def test_restore_keeps_the_later_of_local_and_restored_times(tmp_path, monkeypatch) -> None:
    _, _, state_zip, fetch_at = first_cycle(tmp_path, monkeypatch)
    api = FakeApi(
        [run(60, created=fetch_at, updated=fetch_at)], {60: [artifact(900, 60)]}, {900: state_zip}
    )
    local_later = fetch_at + timedelta(hours=1)
    SourceAttemptLedger(tmp_path / "b" / "raw").record(SRC, OP, local_later)
    report = do_restore(tmp_path / "b", api, now=fetch_at + timedelta(hours=2), ident=identity(61))
    assert report["effective_last_attempted_at"] == local_later.isoformat()
    assert ledger_time(tmp_path / "b") == local_later


# --- ZIP / artifact trust --------------------------------------------------------------------


def mutate_zip(state_zip: bytes, *, add=(), drop=(), replace=None) -> bytes:
    source = zipfile.ZipFile(io.BytesIO(state_zip))
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as target:
        for info in source.infolist():
            if info.filename in drop:
                continue
            body = source.read(info)
            if replace and info.filename in replace:
                body = replace[info.filename](body)
            target.writestr(info.filename, body)
        for name, body in add:
            target.writestr(name, body)
    return buffer.getvalue()


def rewrite_manifest(**changes):
    def apply(body: bytes) -> bytes:
        return json.dumps({**json.loads(body), **changes}).encode("utf-8")

    return {"manifest.json": apply}


@pytest.mark.parametrize(
    ("make", "message"),
    [
        (lambda z: mutate_zip(z, add=[("../escape.json", b"{}")]), "disallowed"),
        (lambda z: mutate_zip(z, add=[("candidate/../../x", b"{}")]), "disallowed"),
        (lambda z: mutate_zip(z, add=[("/abs.json", b"{}")]), "disallowed"),
        (lambda z: mutate_zip(z, add=[("secrets.env", b"TOKEN=x")]), "disallowed"),
        pytest.param(
            lambda z: mutate_zip(z, add=[("attempt-ledger.json", b"{}")]),
            "duplicate",
            marks=pytest.mark.filterwarnings("ignore:Duplicate name"),
        ),
        (lambda z: mutate_zip(z, drop=["attempt-ledger.json"]), "missing"),
        (
            lambda z: mutate_zip(
                z, replace={"attempt-ledger.json": lambda b: b.replace(b"2026", b"2025")}
            ),
            "does not match its manifest",
        ),
        (lambda z: mutate_zip(z, replace=rewrite_manifest(run_id=59)), "identity"),
        (
            lambda z: mutate_zip(
                z, replace=rewrite_manifest(workflow_path=".github/workflows/x.yml")
            ),
            "identity",
        ),
        (lambda z: mutate_zip(z, replace=rewrite_manifest(head_branch="dev")), "identity"),
        (
            lambda z: mutate_zip(
                z, replace=rewrite_manifest(packed_at="2999-01-01T00:00:00+00:00")
            ),
            "future",
        ),
        (lambda z: z[: len(z) // 2], "not a valid ZIP"),
        (lambda z: b"not a zip", "not a valid ZIP"),
    ],
)
def test_malformed_state_artifacts_fail_closed(tmp_path, monkeypatch, make, message) -> None:
    _, _, state_zip, fetch_at = first_cycle(tmp_path, monkeypatch)
    api = FakeApi(
        [run(60, created=fetch_at, updated=fetch_at)],
        {60: [artifact(900, 60)]},
        {900: make(state_zip)},
    )
    with pytest.raises(sas.AttemptStateError, match=message):
        do_restore(tmp_path / "b", api, now=fetch_at + timedelta(hours=1), ident=identity(61))
    assert ledger_time(tmp_path / "b") is None


def test_corrupt_entry_bytes_fail_crc(tmp_path, monkeypatch) -> None:
    _, _, state_zip, fetch_at = first_cycle(tmp_path, monkeypatch)
    stored = io.BytesIO()
    source = zipfile.ZipFile(io.BytesIO(state_zip))
    with zipfile.ZipFile(stored, "w", zipfile.ZIP_STORED) as target:
        for info in source.infolist():
            target.writestr(info.filename, source.read(info))
    data = bytearray(stored.getvalue())
    offset = data.find(b'"schema_version"')
    data[offset + 1] ^= 0xFF
    api = FakeApi(
        [run(60, created=fetch_at, updated=fetch_at)], {60: [artifact(900, 60)]}, {900: bytes(data)}
    )
    with pytest.raises(sas.AttemptStateError, match="corrupt"):
        do_restore(tmp_path / "b", api, now=fetch_at + timedelta(hours=1), ident=identity(61))


def test_artifact_from_another_branch_or_run_is_rejected(tmp_path, monkeypatch) -> None:
    _, _, state_zip, fetch_at = first_cycle(tmp_path, monkeypatch)
    for listed in (artifact(900, 60, branch="dev"), artifact(900, 59)):
        api = FakeApi(
            [run(60, created=fetch_at, updated=fetch_at)], {60: [listed]}, {900: state_zip}
        )
        with pytest.raises(sas.AttemptStateError, match="does not belong"):
            do_restore(tmp_path / "b", api, now=fetch_at + timedelta(hours=1), ident=identity(61))
    # an artifact listed under a run on another branch/workflow is never even queried
    other = run(
        70,
        created=fetch_at + timedelta(hours=1),
        updated=fetch_at + timedelta(hours=1),
        branch="feature",
    )
    api = FakeApi(
        [other, run(60, created=fetch_at, updated=fetch_at)],
        {70: [artifact(901, 70)], 60: [artifact(900, 60)]},
        {900: state_zip},
    )
    report = do_restore(tmp_path / "c", api, now=fetch_at + timedelta(hours=2), ident=identity(61))
    assert report["restored_from_run_id"] == 60
    assert not any("/runs/70/" in path for path in api.paths)


def test_expired_state_falls_back_to_the_run_completion_bound(tmp_path, monkeypatch) -> None:
    _, _, state_zip, fetch_at = first_cycle(tmp_path, monkeypatch)
    done = fetch_at + timedelta(minutes=9)
    api = FakeApi(
        [run(60, created=fetch_at, updated=done)], {60: [artifact(900, 60, expired=True)]}
    )
    report = do_restore(tmp_path / "b", api, now=fetch_at + timedelta(hours=1), ident=identity(61))
    assert report["status"] == "BOOTSTRAPPED_FROM_RUN_BOUNDS"
    assert report["effective_last_attempted_at"] == done.isoformat()


def test_pack_refuses_missing_or_future_ledger_and_bad_candidates(tmp_path) -> None:
    (tmp_path / "feed").mkdir()
    with pytest.raises(sas.AttemptStateError, match="regular file"):
        do_pack(tmp_path, identity(60), 4, NOW)
    SourceAttemptLedger(tmp_path / "raw").record(SRC, OP, NOW + timedelta(hours=1))
    with pytest.raises(sas.AttemptStateError, match="future"):
        do_pack(tmp_path, identity(61), 4, NOW)
    other = tmp_path / "other"
    SourceAttemptLedger(other / "raw").record(SRC, OP, NOW)
    (other / "feed").mkdir()
    (other / "feed" / "schedule.json").write_text(
        '{"artifact_type": "something-else"}', encoding="utf-8"
    )
    (other / "feed" / "schedule-changes.json").write_text("{}", encoding="utf-8")
    with pytest.raises(sas.AttemptStateError, match="public contract"):
        do_pack(other, identity(62), 0, NOW)


# --- adapter / CLI pre-request boundaries ---------------------------------------------------


def adapter_at(now: datetime, registry=None):
    transport = FakeTransport(lambda: now)
    adapter = LoLEsportsScheduleAdapter(
        registry or SourceRegistry.load_default(), transport=transport, clock=lambda: now
    )
    return adapter, transport


def test_adapter_uses_the_later_of_retrieval_and_attempt_times() -> None:
    adapter, transport = adapter_at(NOW)
    recorded: list[datetime] = []
    for retrieved, attempted in (
        (NOW - timedelta(hours=7), NOW - timedelta(hours=1)),
        (NOW - timedelta(hours=1), NOW - timedelta(hours=7)),
    ):
        with pytest.raises(ScheduleFetchIntervalError) as caught:
            adapter.fetch(
                ["lck"],
                last_retrieved_at=retrieved,
                last_attempted_at=attempted,
                on_request_started=recorded.append,
            )
        assert caught.value.retry_at == NOW + timedelta(hours=5)
    assert transport.calls == [] and recorded == []

    adapter.fetch(
        ["lck"],
        last_retrieved_at=NOW - timedelta(hours=7),
        last_attempted_at=NOW - timedelta(hours=6),
        on_request_started=recorded.append,
    )
    assert recorded == [NOW] and len(transport.calls) == 1


def test_policy_and_input_blocks_never_record_or_request(tmp_path) -> None:
    raw = json.loads(
        (ROOT / "src/pro_meta_intelligence/config/source_registry.json").read_text(encoding="utf-8")
    )
    for source in raw["sources"]:
        source["policy_reviewed_at"] = "2000-01-01T00:00:00Z"
    expired = tmp_path / "registry.json"
    expired.write_text(json.dumps(raw), encoding="utf-8")
    recorded: list[datetime] = []
    adapter, transport = adapter_at(NOW, SourceRegistry.from_json(expired))
    with pytest.raises(SourcePolicyError):
        adapter.fetch(["lck"], on_request_started=recorded.append)
    adapter, transport_two = adapter_at(NOW)
    for kwargs in ({"locale": "english"}, {}):
        with pytest.raises(ValueError):
            adapter.fetch(
                ["lck"] if kwargs else ["../x"], on_request_started=recorded.append, **kwargs
            )
    assert recorded == [] and transport.calls == [] and transport_two.calls == []


def test_cli_policy_block_and_interval_block_leave_the_ledger_alone(
    tmp_path, monkeypatch, capsys
) -> None:
    raw = json.loads(
        (ROOT / "src/pro_meta_intelligence/config/source_registry.json").read_text(encoding="utf-8")
    )
    for source in raw["sources"]:
        source["policy_reviewed_at"] = "2000-01-01T00:00:00Z"
    expired = tmp_path / "registry.json"
    expired.write_text(json.dumps(raw), encoding="utf-8")
    code, transport = fetch_schedule(tmp_path, monkeypatch, NOW, registry=expired)
    assert code == 5 and transport.calls == []
    assert ledger_time(tmp_path) is None

    SourceAttemptLedger(tmp_path / "raw").record(SRC, OP, NOW - timedelta(hours=1))
    code, transport = fetch_schedule(tmp_path, monkeypatch, NOW)
    assert code == 3 and transport.calls == []
    assert ledger_time(tmp_path) == NOW - timedelta(hours=1)
    capsys.readouterr()


@pytest.mark.parametrize("kind", ["future", "corrupt", "wrong-source"])
def test_cli_rejects_future_or_corrupt_ledger_before_any_request(
    tmp_path, monkeypatch, capsys, kind
) -> None:
    path = tmp_path / "raw" / SRC / ATTEMPT_LEDGER_FILENAME
    if kind == "future":
        SourceAttemptLedger(tmp_path / "raw").record(SRC, OP, NOW + timedelta(hours=1))
    else:
        path.parent.mkdir(parents=True)
        body = (
            "{not json"
            if kind == "corrupt"
            else json.dumps(
                {"schema_version": "1", "source_id": "oracles-elixir-match-data", "attempts": {}}
            )
        )
        path.write_text(body, encoding="utf-8")
    before = path.read_bytes()
    code, transport = fetch_schedule(tmp_path, monkeypatch, NOW)
    assert code == 6 and transport.calls == []
    result = json.loads(capsys.readouterr().out)
    assert result["status"] == "ATTEMPT_STATE_INVALID"
    assert result["network_collection_performed"] is False
    assert path.read_bytes() == before


def test_unwritable_ledger_stops_the_request(tmp_path, monkeypatch, capsys) -> None:
    def refuse(self, *args, **kwargs):
        raise OSError("read-only file system")

    monkeypatch.setattr(SourceAttemptLedger, "record", refuse)
    code, transport = fetch_schedule(tmp_path, monkeypatch, NOW)
    assert code == 6 and transport.calls == []
    assert json.loads(capsys.readouterr().out)["status"] == "ATTEMPT_STATE_INVALID"


# --- workflow ordering and exit semantics ---------------------------------------------------


def workflow_steps() -> list[tuple[str, str]]:
    """(header, body) per step of the refresh job, from the indentation structure."""

    text = WORKFLOW.read_text(encoding="utf-8")
    refresh = text.split("\n  refresh:\n", 1)[1].split("\n  deploy:\n", 1)[0]
    chunks = re.split(r"\n      - ", refresh)[1:]
    return [(chunk.splitlines()[0], chunk) for chunk in chunks]


def step(name: str) -> str:
    matches = [body for header, body in workflow_steps() if name in body.splitlines()[0]]
    assert len(matches) == 1, name
    return matches[0]


def run_script(body: str) -> str:
    lines = body.split("run: |\n", 1)[1].splitlines()
    return "\n".join(
        line[10:] for line in lines if line.startswith("          ") or not line.strip()
    )


def test_state_is_preserved_before_any_build_push_or_deploy() -> None:
    headers = [body.splitlines()[0] for _, body in workflow_steps()]
    order = [
        "Restore schedule request-attempt state",
        "Fetch policy-gated official schedule",
        "Pack schedule request-attempt state",
        "Preserve schedule request-attempt state",
        "Apply schedule fetch result",
        "Validate public schedule artifacts",
        "actions/upload-pages-artifact",
        "Publish changed schedule artifacts",
    ]
    positions = [next(i for i, h in enumerate(headers) if name in h) for name in order]
    assert positions == sorted(positions)

    assert "if: always() && steps.fetch.outcome == 'success'" in step("Pack schedule")
    upload = step("Preserve schedule request-attempt state")
    assert "if: always() && steps.pack.outcome == 'success'" in upload
    assert "name: schedule-attempt-state" in upload and "overwrite: true" in upload
    assert "path: outputs/schedule-state/upload/" in upload
    # the fetch step never fails itself, so a failed request cannot skip the upload
    assert "exit" not in run_script(step("Fetch policy-gated official schedule"))
    for name in (
        "Validate public schedule",
        "configure-pages",
        "upload-pages-artifact",
        "Publish changed",
    ):
        assert "if: steps.outcome.outputs.publish == 'true'" in step(name)
    text = WORKFLOW.read_text(encoding="utf-8")
    deploy = text.split("\n  deploy:\n", 1)[1]
    assert "if: needs.refresh.outputs.publish == 'true'" in deploy
    assert "group: pages" in text and "cancel-in-progress: false" in text
    assert "actions: read" in text
    restore = step("Restore schedule request-attempt state")
    assert "--workflow-path .github/workflows/schedule-refresh.yml" in restore
    assert "GH_TOKEN: ${{ github.token }}" in restore
    assert "secrets." not in text


def real_bash() -> str | None:
    """A POSIX bash; the Windows System32 WSL launcher does not count."""

    for candidate in (shutil.which("bash"), r"C:\Program Files\Git\bin\bash.exe"):
        if candidate and "system32" not in candidate.lower() and Path(candidate).is_file():
            return candidate
    return None


@pytest.mark.skipif(real_bash() is None, reason="bash is required")
@pytest.mark.parametrize(
    ("status", "exit_code", "publish"),
    [
        ("0", 0, "true"),
        ("3", 0, "false"),
        ("4", 4, None),
        ("5", 5, None),
        ("6", 6, None),
        ("", 1, None),
    ],
)
def test_fetch_result_step_exit_semantics(tmp_path, status, exit_code, publish) -> None:
    script = tmp_path / "outcome.sh"
    script.write_text(run_script(step("Apply schedule fetch result")), encoding="utf-8")
    output = tmp_path / "github-output"
    output.write_text("", encoding="utf-8")
    completed = subprocess.run(
        [real_bash(), "-e", script.as_posix()],
        env={**os.environ, "FETCH_STATUS": status, "GITHUB_OUTPUT": output.as_posix()},
        capture_output=True,
        check=False,
    )
    assert completed.returncode == exit_code
    written = output.read_text(encoding="utf-8")
    assert written == (f"publish={publish}\n" if publish else "")
