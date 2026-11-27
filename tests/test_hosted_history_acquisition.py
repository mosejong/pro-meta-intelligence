"""Hosted history-only routing and acquisition outcomes. No test performs a provider request."""

import json
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

import pro_meta_intelligence.ingestion.oe_download as oe_download
from ops import hosted_history_acquisition as hha
from pro_meta_intelligence.ingestion.http import HttpTransportError
from pro_meta_intelligence.sources import RawSourceArtifact, SnapshotArchive, SourceAttemptLedger
from tests.test_career_public_budget import feed, status
from tests.test_oe_download import FakeTransport, fixture_csv
from tests.test_private_archive import _archive as seed_archive

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = (ROOT / ".github/workflows/hosted-oe-sync.yml").read_text(encoding="utf-8")
SRC = "oracles-elixir-match-data"
OP = "FETCH_PUBLISHED_CSV"
NOW = datetime(2026, 11, 18, 12, tzinfo=UTC)  # inside the reviewed source-policy window
HISTORY = "env.HISTORY_ONLY == 'true'"
NOT_HISTORY = "env.HISTORY_ONLY != 'true'"


# --------------------------------------------------------------------------- workflow routing


def sync_steps():
    job = WORKFLOW.split("\n  sync:\n", 1)[1].split("\n  deploy:\n", 1)[0]
    body = job.split("\n    steps:\n", 1)[1]
    blocks = re.split(r"\n(?=      - )", "\n" + body)
    steps = []
    for block in blocks:
        if not block.strip():
            continue
        name = re.search(r"name: (.+)", block)
        uses = re.search(r"uses: (\S+)", block)
        step_if = re.search(r"^        if: (.+)$", block, re.MULTILINE)
        step_id = re.search(r"^        id: (\S+)$", block, re.MULTILINE)
        steps.append(
            {
                "label": (name or uses).group(1),
                "id": step_id.group(1) if step_id else None,
                "if": step_if.group(1) if step_if else None,
                "block": block,
            }
        )
    return steps


def step(label_fragment):
    matches = [s for s in sync_steps() if label_fragment in s["label"] or s["id"] == label_fragment]
    assert len(matches) == 1, label_fragment
    return matches[0]


def index(label_fragment):
    target = step(label_fragment)["label"]
    return [s["label"] for s in sync_steps()].index(target)


def test_history_only_input_is_manual_boolean_default_false_and_adds_no_schedule():
    inputs = WORKFLOW.split("workflow_dispatch:", 1)[1].split("\npermissions:", 1)[0]
    history = inputs.split("history_only:", 1)[1]
    assert "required: false" in history
    assert "default: false" in history
    assert "type: boolean" in history
    assert WORKFLOW.count("cron:") == 1
    assert 'cron: "13 1,7,13,19 * * *"' in WORKFLOW
    # Scheduled runs carry no inputs, so history mode can only come from a manual dispatch.
    assert (
        "HISTORY_ONLY: ${{ github.event_name == 'workflow_dispatch' && "
        "inputs.history_only == true }}" in WORKFLOW
    )
    assert "group: pages" in WORKFLOW
    assert "cancel-in-progress: false" in WORKFLOW


def test_history_path_runs_after_restore_before_repack_and_never_calls_current_sync():
    history = step("history-acquisition")
    assert history["if"] == HISTORY  # implicit success(): restore/key failures skip it
    assert "always()" not in history["if"]
    assert "continue-on-error: true" in history["block"]
    assert "python ops/hosted_history_acquisition.py" in history["block"]
    assert "--restore-report" in history["block"]
    assert "sync-oe-feed" not in history["block"]
    assert "fetch-oe" not in history["block"]
    assert index("Require the private archive secret") < index("restore")
    assert index("restore") < index("history-acquisition")
    assert index("history-acquisition") < index("sync-health")
    assert index("history-acquisition") < index("Repack authenticated private history")
    assert step("sync-health")["if"] == NOT_HISTORY


def test_state_is_repacked_and_retained_after_any_history_outcome():
    diagnostics = step("Preserve history-only acquisition diagnostics")
    assert diagnostics["if"] == f"always() && {HISTORY}"
    assert "continue-on-error: true" in diagnostics["block"]
    assert "history-acquisition.json" in diagnostics["block"]
    assert ".pmi" not in diagnostics["block"]
    assert "PRIVATE_ARCHIVE_DIR" not in diagnostics["block"]
    # Repack, upload and retention keep the implicit success() condition shared by both modes:
    # they run after any continue-on-error history outcome but never after a failed restore.
    for label in (
        "Repack authenticated private history",
        "archive-upload",
        "Keep the two newest encrypted history states",
    ):
        assert step(label)["if"] is None, label
    assert index("Preserve history-only acquisition diagnostics") < index(
        "Repack authenticated private history"
    )


def test_history_failure_is_propagated_only_after_private_state_preservation():
    final = step("Report the history-only outcome")
    assert final["if"] == f"always() && {HISTORY}"
    assert index("Keep the two newest encrypted history states") < index(
        "Report the history-only outcome"
    )
    assert "${{ steps.history-acquisition.outcome }}" in final["block"]
    assert 'if [[ "$HISTORY_OUTCOME" != "success" ]]' in final["block"]
    assert "exit 1" in final["block"]
    assert sync_steps()[-1]["label"] == final["label"]


PUBLIC_MARKERS = (
    "sync-oe-feed",
    "check-oe-feed-health",
    "refresh_draft_scouts.py",
    "build_player_season_history.py",
    "git checkout --",
    "npm ",
    "configure-pages",
    "upload-pages-artifact",
    "git push",
    "git commit",
    "notifications collector",
)


def test_every_public_sync_build_push_upload_and_deploy_step_excludes_history_mode():
    guarded = []
    for current in sync_steps():
        text = current["block"]
        if any(marker in text for marker in PUBLIC_MARKERS):
            assert current["if"] and NOT_HISTORY in current["if"], current["label"]
            guarded.append(current["label"])
    assert len(guarded) >= 9
    deploy = WORKFLOW.split("\n  deploy:\n", 1)[1]
    assert (
        "if: always() && needs.sync.outputs.pages_ready == 'true' && "
        "!(github.event_name == 'workflow_dispatch' && inputs.history_only == true)" in deploy
    )


def test_history_mode_refuses_fresh_start_and_default_restore_is_unchanged():
    restore = step("restore")["block"]
    refusal = restore.index('"$ALLOW_FRESH_START" == "true" && "$HISTORY_ONLY" == "true"')
    assert refusal < restore.index('restore_source="EXPLICIT_FRESH_START"')
    assert "fresh start is refused" in restore
    assert "No hosted private history exists." in restore


def simulate(history_only, failing=None):
    """Evaluate step conditions with GitHub's implicit success() and continue-on-error rules.

    ``failing`` names one step label that fails; every other executed step succeeds.
    """
    flag = "true" if history_only else "false"
    ran = []
    outcomes = {}
    job_failed = False
    for current in sync_steps():
        condition = current["if"]
        uses_always = condition is not None and "always()" in condition
        if not uses_always and job_failed:
            run = False
        elif condition is None:
            run = True
        else:
            expression = condition.removeprefix("${{ ").removesuffix(" }}")
            expression = expression.replace("always() && ", "").replace("always()", "True")
            expression = expression.replace(HISTORY, str(flag == "true"))
            expression = expression.replace(NOT_HISTORY, str(flag != "true"))
            expression = re.sub(
                r"steps\.([\w-]+)\.outcome (==|!=) '(\w+)'",
                lambda m: (
                    repr(outcomes.get(m.group(1), "skipped")) + f" {m.group(2)} {m.group(3)!r}"
                ),
                expression,
            )
            run = eval(expression.replace("&&", "and"))  # noqa: S307 - test-only, local text
        outcome = "skipped"
        if run:
            ran.append(current["label"])
            outcome = "failure" if current["label"] == failing else "success"
            if outcome == "failure" and "continue-on-error: true" not in current["block"]:
                job_failed = True
        if current["id"]:
            outcomes[current["id"]] = outcome
    return ran


REPACK = "Repack authenticated private history without publishing raw rows"
ARCHIVE_UPLOAD = "Upload redundant rolling private history state"
RETENTION = "Keep the two newest encrypted history states"


def test_no_history_mode_step_failure_before_repack_can_lose_the_attempt_ledger():
    labels = [s["label"] for s in sync_steps()]
    start = labels.index("Attempt at most one missing historical annual file (history-only mode)")
    between = [
        label for label in simulate(True) if start <= labels.index(label) < labels.index(REPACK)
    ]
    assert "Preserve history-only acquisition diagnostics" in between
    # The current-only diagnostics upload has no continue-on-error, so it must not run here.
    assert "Preserve public-safe sync diagnostics on success or rejection" not in between
    for label in between:
        ran = simulate(True, failing=label)
        for required in (REPACK, ARCHIVE_UPLOAD, RETENTION, "Report the history-only outcome"):
            assert any(required in name for name in ran), (label, required)


def test_current_diagnostics_step_is_current_only_and_default_still_uploads_on_rejection():
    diagnostics = step("Preserve public-safe sync diagnostics on success or rejection")
    assert diagnostics["if"] == "${{ always() && env.HISTORY_ONLY != 'true' }}"
    assert "Preserve public-safe sync diagnostics on success or rejection" in simulate(False)
    assert "Preserve public-safe sync diagnostics on success or rejection" not in simulate(True)
    # Default behavior unchanged: a sync rejection (continue-on-error) still uploads and repacks.
    rejected = simulate(
        False, failing="Run policy-gated OE sync and fail-closed local health check"
    )
    assert "Preserve public-safe sync diagnostics on success or rejection" in rejected
    assert REPACK in rejected and ARCHIVE_UPLOAD in rejected
    assert "Preserve failed collection health after publishing its public status" in rejected


def test_simulated_routes_keep_default_unchanged_and_history_private():
    default = simulate(False)
    history = simulate(True)
    for label in default:
        assert "history-only" not in label.lower() or "Report" in label
    assert "Attempt at most one missing historical annual file (history-only mode)" not in default
    assert "Run policy-gated OE sync and fail-closed local health check" in default
    assert "Publish only the reviewed public feed heads" in default
    assert "actions/upload-pages-artifact@v5" in default
    assert "Attempt at most one missing historical annual file (history-only mode)" in history
    assert "Repack authenticated private history without publishing raw rows" in history
    assert "Upload redundant rolling private history state" in history
    for forbidden in (
        "Run policy-gated OE sync and fail-closed local health check",
        "Refresh scouting packs from the accepted feed source",
        "Refresh season player history from the accepted feed source",
        "Validate and build the independent Pages artifact",
        "actions/configure-pages@v6",
        "actions/upload-pages-artifact@v5",
        "Publish only the reviewed public feed heads",
        "Preserve failed collection health after publishing its public status",
    ):
        assert forbidden not in history, forbidden


# --------------------------------------------------------------------------- helper behavior


AUTHENTICATED = {
    "artifact_type": "restored-private-oe-archive",
    "source_id": SRC,
    "authenticated": True,
}


def restored(tmp_path, report=AUTHENTICATED, *, seed=True):
    """A restored hosted archive always carries prior (current-season) snapshots."""
    archive = tmp_path / "archive"
    archive.mkdir(parents=True, exist_ok=True)
    if seed:
        seed_archive(archive)  # retrieved 2026-08-23/24: far outside the 24h interval
    restore = tmp_path / "restore-report.json"
    if report is not False:
        restore.write_text(json.dumps(report), encoding="utf-8")
    return archive, restore


def public_records(tmp_path, at):
    f, s = tmp_path / "feed.json", tmp_path / "status.json"
    f.write_text(json.dumps(feed(at)), encoding="utf-8")
    s.write_text(json.dumps(status(at, at)), encoding="utf-8")
    return f, s


def run(tmp_path, archive, restore, fetch_next, *, now=NOW, records_at=None):
    f, s = public_records(tmp_path, records_at or (NOW - timedelta(days=3)))
    return hha.run(
        archive_dir=archive,
        restore_report=restore,
        attempt_output=tmp_path / "attempt.json",
        public_feed=f,
        public_collection_status=s,
        now=now,
        fetch_next=fetch_next,
    )


def forbidden_fetch(argv):
    raise AssertionError("provider path must not be reached")


@pytest.mark.parametrize(
    ("report", "issue"),
    [
        (False, "RESTORE_REPORT_MISSING"),
        (None, "RESTORE_REPORT_INVALID_SHAPE"),  # JSON null must not read as "no issue"
        (
            {"artifact_type": "restored-private-oe-archive", "source_id": SRC},
            "RESTORE_NOT_AUTHENTICATED",
        ),
        (
            {"artifact_type": "other", "source_id": SRC, "authenticated": True},
            "RESTORE_NOT_AUTHENTICATED",
        ),
        (["not", "an", "object"], "RESTORE_REPORT_INVALID_SHAPE"),
    ],
)
def test_missing_or_unauthenticated_restore_never_delegates(tmp_path, report, issue):
    archive, restore = restored(tmp_path, report)
    result, code = run(tmp_path, archive, restore, forbidden_fetch)
    assert code == 1
    assert result["outcome"] == "BLOCKED_PRECONDITION"
    assert issue in result["issues"]
    assert result["delegated"] is False
    assert result["publication_performed"] is False
    assert SourceAttemptLedger(archive).latest_attempted_at(SRC, OP) is None


def test_missing_archive_corrupt_archive_and_expired_policy_never_delegate(tmp_path):
    archive, restore = restored(tmp_path, seed=False)
    result, code = run(tmp_path, archive, restore, forbidden_fetch)
    assert (code, result["issues"]) == (1, ["ARCHIVE_EMPTY"])

    archive.rmdir()
    result, code = run(tmp_path, archive, restore, forbidden_fetch)
    assert (code, result["issues"]) == (1, ["ARCHIVE_DIR_MISSING"])

    archive.mkdir()
    url = "https://drive.usercontent.google.com/download?id=1EHmptHyzY8owv0BAcNKtkQpMwfkURwRy"
    stored = SnapshotArchive(archive).store(
        RawSourceArtifact.create(
            source_id=SRC,
            request_url=url,
            final_url=url,
            media_type="text/csv",
            retrieved_at=NOW - timedelta(days=5),
            body=b"gameid,year\n1,2022\n",
        )
    )
    stored.data_path.write_bytes(b"tampered")
    result, code = run(tmp_path, archive, restore, forbidden_fetch)
    assert code == 1 and "ARCHIVE_INTEGRITY_FAILED" in result["issues"]

    clean, _ = restored(tmp_path / "clean")
    result, code = run(tmp_path, clean, restore, forbidden_fetch, now=NOW + timedelta(days=60))
    assert code == 1
    assert "SOURCE_POLICY_POLICY_REVIEW_EXPIRED" in result["issues"]


def test_invalid_attempt_ledger_fails_closed(tmp_path):
    archive, restore = restored(tmp_path)
    SourceAttemptLedger(archive).record(SRC, OP, NOW - timedelta(days=3))
    ledger_file = next(archive.rglob("*attempt*"))
    ledger_file.write_text("{not json", encoding="utf-8")
    result, code = run(tmp_path, archive, restore, forbidden_fetch)
    assert code == 1 and "ATTEMPT_LEDGER_INVALID" in result["issues"]


@pytest.mark.parametrize(
    ("exit_code", "attempt", "plan", "recorded", "outcome"),
    [
        (0, {"status": "DOWNLOADED"}, None, True, "ACQUIRED"),
        (0, None, {"next_year": None}, False, "NOTHING_MISSING"),
        (3, {"status": "RATE_LIMITED"}, None, False, "DEFERRED"),
        (3, None, {"next_year": 2015, "can_attempt_now": False}, False, "DEFERRED"),
        (
            3,
            None,
            {"next_year": 2015, "public_budget_check": {"status": "BLOCKED"}},
            False,
            "BLOCKED_PUBLIC_RECORDS",
        ),
        (3, None, {"next_year": 2015}, True, "FAILED"),  # deferral cannot hide a new attempt
        (4, {"status": "SOURCE_UNAVAILABLE"}, None, True, "SOURCE_UNAVAILABLE"),
        (0, None, {"next_year": 2015}, False, "FAILED"),  # success without a download is not
        (0, None, None, False, "FAILED"),
        (None, None, None, True, "FAILED"),
        (1, None, None, False, "FAILED"),
    ],
)
def test_classification_never_reports_deferral_as_acquisition(
    exit_code, attempt, plan, recorded, outcome
):
    assert hha.classify(exit_code, attempt, plan, attempt_recorded=recorded) == outcome


def test_delegates_exactly_once_with_shared_public_budget_inputs(tmp_path):
    archive, restore = restored(tmp_path)
    calls = []

    def fake(argv):
        calls.append(argv)
        print(json.dumps({"next_year": 2015, "can_attempt_now": False, "next_attempt_at": "x"}))
        return 3

    result, code = run(tmp_path, archive, restore, fake)
    assert len(calls) == 1
    argv = calls[0]
    assert argv[0] == "--fetch-next"
    assert argv[argv.index("--archive-dir") + 1] == str(archive)
    assert "--public-feed" in argv and "--public-collection-status" in argv
    assert (code, result["outcome"]) == (0, "DEFERRED")
    assert result["request_attempt_recorded"] is False
    assert result["plan"]["next_year"] == 2015


def test_failure_after_recorded_attempt_is_reported_and_ledger_survives(tmp_path):
    archive, restore = restored(tmp_path)

    def crash(argv):
        SourceAttemptLedger(archive).record(SRC, OP, NOW)
        raise RuntimeError("transport crashed")

    result, code = run(tmp_path, archive, restore, crash)
    assert code == 1
    assert result["outcome"] == "FAILED"
    assert result["request_attempt_recorded"] is True
    assert "transport crashed" in result["error"]
    assert SourceAttemptLedger(archive).latest_attempted_at(SRC, OP) == NOW


@pytest.fixture
def offline_provider(monkeypatch):
    """Route the real fetch-oe path to an in-memory transport; any real transport is refused."""
    state = {"transport": None, "refused": []}

    class RefusingTransport:
        def fetch(self, url, **kwargs):
            state["refused"].append(url)
            raise AssertionError("no provider request may be made in this test")

    def factory(**kwargs):
        # Planning constructs an adapter (and so a transport) without fetching.
        return state["transport"] or RefusingTransport()

    monkeypatch.setattr(oe_download, "UrllibTransport", factory)
    monkeypatch.setattr(oe_download, "_utc_now", lambda: NOW)
    return state


class FailingTransport:
    def __init__(self):
        self.calls = []

    def fetch(self, url, **kwargs):
        self.calls.append(url)
        raise HttpTransportError("simulated provider outage")


def test_real_delegation_persists_failed_network_attempt_and_fails(tmp_path, offline_provider):
    archive, restore = restored(tmp_path)
    offline_provider["transport"] = FailingTransport()
    real_old = datetime.now(UTC) - timedelta(days=3)
    result, code = run(tmp_path, archive, restore, None, records_at=real_old)
    assert code == 1
    assert result["outcome"] == "SOURCE_UNAVAILABLE"
    assert result["attempt"]["status"] == "SOURCE_UNAVAILABLE"
    assert result["request_attempt_recorded"] is True
    assert len(offline_provider["transport"].calls) == 1
    assert "id=1qyckLuw0-hJM8XqFhlV9l1xAbr3H78T_" in offline_provider["transport"].calls[0]
    assert SourceAttemptLedger(archive).latest_attempted_at(SRC, OP) == NOW


def test_real_delegation_acquires_one_past_year_into_private_archive(tmp_path, offline_provider):
    archive, restore = restored(tmp_path)
    transport = FakeTransport(fixture_csv())
    offline_provider["transport"] = transport
    real_old = datetime.now(UTC) - timedelta(days=3)
    result, code = run(tmp_path, archive, restore, None, records_at=real_old)
    assert (code, result["outcome"]) == (0, "ACQUIRED")
    assert result["attempt"]["year"] == 2015
    assert len(transport.calls) == 1
    inspection = SnapshotArchive(archive).inspect(SRC)
    assert not inspection.issues
    assert len(inspection.snapshots) == 3  # two seeded hosted snapshots + one 2015 file
    assert "raw_data_path" not in result["attempt"]


def test_real_delegation_with_recent_shared_attempt_is_deferred_without_transport(
    tmp_path, offline_provider
):
    archive, restore = restored(tmp_path)
    real_now = datetime.now(UTC)
    SourceAttemptLedger(archive).record(SRC, OP, real_now - timedelta(hours=1))
    result, code = run(
        tmp_path, archive, restore, None, now=NOW, records_at=real_now - timedelta(days=3)
    )
    assert (code, result["outcome"]) == (0, "DEFERRED")
    assert result["request_attempt_recorded"] is False
    assert offline_provider["refused"] == []


def test_real_delegation_with_recent_public_attempt_is_deferred_without_transport(
    tmp_path, offline_provider
):
    archive, restore = restored(tmp_path)
    recent = datetime.now(UTC) - timedelta(hours=2)
    result, code = run(tmp_path, archive, restore, None, records_at=recent)
    assert (code, result["outcome"]) == (0, "DEFERRED")
    assert result["plan"]["can_attempt_now"] is False
    assert offline_provider["refused"] == []


def test_cli_refuses_to_overwrite_and_writes_bounded_report(tmp_path, monkeypatch):
    archive, restore = restored(tmp_path)
    report = tmp_path / "out/report.json"
    args = [
        "--archive-dir",
        str(archive),
        "--restore-report",
        str(tmp_path / "missing.json"),
        "--attempt-output",
        str(tmp_path / "out/attempt.json"),
        "--report",
        str(report),
    ]
    monkeypatch.setattr(hha.player_career_archive, "main", forbidden_fetch)
    assert hha.main(args) == 1
    written = json.loads(report.read_text(encoding="utf-8"))
    assert written["outcome"] == "BLOCKED_PRECONDITION"
    assert written["mode"] == "HISTORY_ONLY"
    with pytest.raises(SystemExit):
        hha.main(args)
