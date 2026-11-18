"""Carry the official-schedule request budget across ephemeral GitHub Actions runners.

`pack` copies only the schedule request-attempt ledger, the validated public schedule
snapshot/change log and the run's failure diagnostics into a small state directory that the
workflow uploads as an artifact right after the request step. `restore` runs before the next
request: it trusts only state from the `main` branch runs of this exact workflow in this
repository, verifies the ZIP against a strict allowlist and the packed manifest, and merges the
ledger into the archive root so the policy interval is enforced across runners.

When a trusted run has no state artifact (first migration, an upload that never happened, a
runner that died) the run's completion time is used as a conservative upper bound for a request
it *may* have sent. That bound is recorded as spent budget, never as proof that a request was
performed. Missing evidence, unreadable API responses, future timestamps and malformed ZIPs all
fail closed: an empty state is never treated as a fresh start.

No Oracle's Elixir data, raw archive, secret, token or key is read or written here.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import quote

from pro_meta_intelligence.sources import SourceAttemptLedger, SourceAttemptLedgerError
from pro_meta_intelligence.sources.artifacts import ATTEMPT_LEDGER_FILENAME

SOURCE_ID = "lol-esports-schedule"
OPERATION = "FETCH_SCHEDULE_HTML"
WORKFLOW_PATH = ".github/workflows/schedule-refresh.yml"
TRUSTED_BRANCH = "main"
TRUSTED_EVENTS = frozenset({"schedule", "workflow_dispatch"})
STATE_ARTIFACT_NAME = "schedule-attempt-state"
ARTIFACT_TYPE = "schedule-attempt-state"
CLOCK_SKEW = timedelta(minutes=5)
RUN_PAGE_SIZE = 30
MAX_ZIP_BYTES = 16 * 1024 * 1024
LEDGER_NAME = "attempt-ledger.json"
MANIFEST_NAME = "manifest.json"
SCHEDULE_NAME = "candidate/schedule.json"
CHANGES_NAME = "candidate/schedule-changes.json"
RESULT_NAME = "diagnostics/result.json"
PAGE_NAME = "diagnostics/source-page.html"
# exact relative paths and their maximum uncompressed sizes; nothing else is accepted
ALLOWED_FILES: dict[str, int] = {
    MANIFEST_NAME: 64 * 1024,
    LEDGER_NAME: 64 * 1024,
    SCHEDULE_NAME: 2 * 1024 * 1024,
    CHANGES_NAME: 2 * 1024 * 1024,
    RESULT_NAME: 256 * 1024,
    PAGE_NAME: 5 * 1024 * 1024,
}
ALLOWED_DIRECTORIES = frozenset({"candidate/", "diagnostics/"})
CONTENT_HASH = re.compile(r"^sha256:[0-9a-f]{64}$")
QUEUED_STATUSES = frozenset({"queued", "waiting", "pending", "requested"})


class AttemptStateError(RuntimeError):
    """Raised whenever state cannot be proven safe; the caller must not request the source."""


class GitHubApi(Protocol):
    def get_json(self, path: str) -> Any: ...

    def download(self, path: str, destination: Path, maximum_bytes: int) -> None: ...


class GhCliApi:
    """Read-only GitHub REST access through the preinstalled `gh` CLI (uses GH_TOKEN)."""

    def __init__(self, runner: Callable[..., subprocess.CompletedProcess[bytes]] = subprocess.run):
        self.runner = runner

    def _call(self, path: str) -> bytes:
        try:
            completed = self.runner(
                ["gh", "api", "-H", "Accept: application/vnd.github+json", path],
                capture_output=True,
                check=False,
                timeout=120,
            )
        except (OSError, subprocess.SubprocessError) as error:
            raise AttemptStateError("GitHub API is unavailable") from error
        if completed.returncode != 0:
            raise AttemptStateError(f"GitHub API request failed for {path}")
        return completed.stdout

    def get_json(self, path: str) -> Any:
        try:
            return json.loads(self._call(path).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise AttemptStateError("GitHub API returned invalid JSON") from error

    def download(self, path: str, destination: Path, maximum_bytes: int) -> None:
        body = self._call(path)
        if len(body) > maximum_bytes:
            raise AttemptStateError("state artifact exceeds the size limit")
        destination.write_bytes(body)


@dataclass(frozen=True, slots=True)
class RunIdentity:
    repository: str
    run_id: int
    run_attempt: int
    workflow_path: str = WORKFLOW_PATH

    def __post_init__(self) -> None:
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", self.repository):
            raise AttemptStateError("repository identity is invalid")
        if self.workflow_path != WORKFLOW_PATH:
            raise AttemptStateError("only the schedule refresh workflow may carry this state")
        if self.run_id < 1 or self.run_attempt < 1:
            raise AttemptStateError("run identity is invalid")


# --- shared validation ----------------------------------------------------------------------


def _parse_time(value: object, label: str) -> datetime:
    if not isinstance(value, str) or not value:
        raise AttemptStateError(f"{label} is missing")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise AttemptStateError(f"{label} is not an ISO-8601 time") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise AttemptStateError(f"{label} must carry a timezone")
    return parsed


def _not_future(value: datetime, now: datetime, label: str) -> datetime:
    if value > now + CLOCK_SKEW:
        raise AttemptStateError(f"{label} is in the future")
    return value


def _sha256(body: bytes) -> str:
    return f"sha256:{hashlib.sha256(body).hexdigest()}"


def _ledger_latest_from_bytes(body: bytes, now: datetime) -> datetime:
    """Validate ledger bytes with the production ledger reader, in an isolated temp root."""

    with tempfile.TemporaryDirectory(prefix="schedule-ledger-") as temporary:
        root = Path(temporary)
        (root / SOURCE_ID).mkdir()
        (root / SOURCE_ID / ATTEMPT_LEDGER_FILENAME).write_bytes(body)
        try:
            latest = SourceAttemptLedger(root).latest_attempted_at(SOURCE_ID, OPERATION)
        except (SourceAttemptLedgerError, ValueError) as error:
            raise AttemptStateError("state ledger is malformed") from error
    if latest is None:
        raise AttemptStateError("state ledger has no schedule request attempt")
    return _not_future(latest, now, "state ledger attempt")


def _validate_snapshot(body: bytes, now: datetime) -> datetime:
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise AttemptStateError("schedule snapshot is not valid JSON") from error
    if not (
        isinstance(payload, dict)
        and payload.get("schema_version") == "1"
        and payload.get("artifact_type") == "pro-schedule-snapshot"
        and payload.get("source_id") == SOURCE_ID
        and isinstance(payload.get("events"), list)
        and isinstance(payload.get("content_hash"), str)
        and CONTENT_HASH.fullmatch(payload["content_hash"])
    ):
        raise AttemptStateError("schedule snapshot does not match the public contract")
    retrieved_at = _parse_time(payload.get("retrieved_at"), "schedule snapshot retrieved_at")
    return _not_future(retrieved_at, now, "schedule snapshot retrieved_at")


def _validate_json_object(body: bytes, label: str) -> None:
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise AttemptStateError(f"{label} is not valid JSON") from error
    if not isinstance(payload, dict):
        raise AttemptStateError(f"{label} must be a JSON object")


def _read_limited(path: Path, name: str) -> bytes:
    if path.is_symlink() or not path.is_file():
        raise AttemptStateError(f"{name} is not a regular file")
    if path.stat().st_size > ALLOWED_FILES[name]:
        raise AttemptStateError(f"{name} exceeds the size limit")
    return path.read_bytes()


def _validate_candidate(files: dict[str, bytes], now: datetime) -> str | None:
    present = {name for name in (SCHEDULE_NAME, CHANGES_NAME) if name in files}
    if not present:
        return None
    if present != {SCHEDULE_NAME, CHANGES_NAME}:
        raise AttemptStateError("candidate snapshot and change log must be kept together")
    retrieved_at = _validate_snapshot(files[SCHEDULE_NAME], now)
    _validate_json_object(files[CHANGES_NAME], "candidate change log")
    return retrieved_at.isoformat()


# --- pack -----------------------------------------------------------------------------------


def pack(
    *,
    identity: RunIdentity,
    archive_dir: Path,
    output_dir: Path,
    fetch_status: int,
    schedule: Path,
    changes: Path,
    diagnostics_dir: Path | None,
    previous_candidate_dir: Path | None,
    now: datetime,
) -> dict[str, Any]:
    """Build the minimal state directory uploaded after the request step."""

    if output_dir.exists() and any(output_dir.iterdir()):
        raise AttemptStateError("state output directory must be empty")
    ledger_path = archive_dir / SOURCE_ID / ATTEMPT_LEDGER_FILENAME
    files: dict[str, bytes] = {LEDGER_NAME: _read_limited(ledger_path, LEDGER_NAME)}
    latest = _ledger_latest_from_bytes(files[LEDGER_NAME], now)

    candidate_origin = "NONE"
    if fetch_status == 0:
        files[SCHEDULE_NAME] = _read_limited(schedule, SCHEDULE_NAME)
        files[CHANGES_NAME] = _read_limited(changes, CHANGES_NAME)
        candidate_origin = "THIS_RUN_SOURCE_SUCCESS"
    elif previous_candidate_dir is not None and (previous_candidate_dir / "schedule.json").exists():
        # carried forward byte-for-byte: its retrieved_at stays the original acquisition time
        files[SCHEDULE_NAME] = _read_limited(
            previous_candidate_dir / "schedule.json", SCHEDULE_NAME
        )
        files[CHANGES_NAME] = _read_limited(
            previous_candidate_dir / "schedule-changes.json", CHANGES_NAME
        )
        candidate_origin = "CARRIED_FORWARD_FROM_RESTORED_STATE"
    candidate_retrieved_at = _validate_candidate(files, now)

    if diagnostics_dir is not None:
        for name, filename in ((RESULT_NAME, "result.json"), (PAGE_NAME, "source-page.html")):
            path = diagnostics_dir / filename
            if path.exists():
                files[name] = _read_limited(path, name)

    manifest = {
        "schema_version": "1",
        "artifact_type": ARTIFACT_TYPE,
        "repository": identity.repository,
        "workflow_path": identity.workflow_path,
        "head_branch": TRUSTED_BRANCH,
        "run_id": identity.run_id,
        "run_attempt": identity.run_attempt,
        "packed_at": now.isoformat(),
        "fetch_exit_code": fetch_status,
        "ledger_latest_attempted_at": latest.isoformat(),
        "candidate_origin": candidate_origin,
        "candidate_retrieved_at": candidate_retrieved_at,
        "files": {
            name: {"bytes": len(body), "content_hash": _sha256(body)}
            for name, body in sorted(files.items())
        },
        "boundary": (
            "Schedule request-attempt budget and public schedule outputs only. No Oracle's "
            "Elixir data, raw archive, secret, token or key."
        ),
    }
    files[MANIFEST_NAME] = (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode("utf-8")
    for name, body in files.items():
        destination = output_dir / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(body)
    return manifest


# --- restore --------------------------------------------------------------------------------


def read_state_zip(path: Path, *, run_id: int, identity: RunIdentity, now: datetime) -> dict:
    """Return validated state from one downloaded artifact ZIP, or raise."""

    if path.stat().st_size > MAX_ZIP_BYTES:
        raise AttemptStateError("state artifact exceeds the size limit")
    try:
        archive = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError) as error:
        raise AttemptStateError("state artifact is not a valid ZIP") from error
    files: dict[str, bytes] = {}
    with archive:
        seen: set[str] = set()
        for info in archive.infolist():
            name = info.filename
            if name in seen:
                raise AttemptStateError("state artifact contains duplicate entries")
            seen.add(name)
            mode = info.external_attr >> 16
            if stat.S_ISLNK(mode) or info.flag_bits & 0x1:
                raise AttemptStateError("state artifact contains a link or encrypted entry")
            if name in ALLOWED_DIRECTORIES and info.is_dir() and info.file_size == 0:
                continue
            if name not in ALLOWED_FILES or info.is_dir():
                raise AttemptStateError(f"state artifact contains a disallowed entry: {name!r}")
            if info.file_size > ALLOWED_FILES[name]:
                raise AttemptStateError(f"state artifact entry is too large: {name}")
            try:
                with archive.open(info) as handle:
                    body = handle.read(ALLOWED_FILES[name] + 1)
            except (zipfile.BadZipFile, OSError, RuntimeError, ValueError) as error:
                raise AttemptStateError("state artifact entry is corrupt") from error
            if len(body) != info.file_size:
                raise AttemptStateError("state artifact entry size does not match")
            files[name] = body
    if MANIFEST_NAME not in files or LEDGER_NAME not in files:
        raise AttemptStateError("state artifact is missing its manifest or ledger")
    try:
        manifest = json.loads(files[MANIFEST_NAME].decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise AttemptStateError("state manifest is not valid JSON") from error
    if not isinstance(manifest, dict) or not (
        manifest.get("schema_version") == "1"
        and manifest.get("artifact_type") == ARTIFACT_TYPE
        and manifest.get("repository") == identity.repository
        and manifest.get("workflow_path") == identity.workflow_path
        and manifest.get("head_branch") == TRUSTED_BRANCH
        and manifest.get("run_id") == run_id
        and isinstance(manifest.get("run_attempt"), int)
    ):
        raise AttemptStateError("state manifest identity does not match this workflow on main")
    _not_future(_parse_time(manifest.get("packed_at"), "state packed_at"), now, "state packed_at")
    declared = manifest.get("files")
    payload_files = {name: body for name, body in files.items() if name != MANIFEST_NAME}
    if not isinstance(declared, dict) or set(declared) != set(payload_files):
        raise AttemptStateError("state manifest file list does not match the artifact")
    for name, body in payload_files.items():
        if declared[name] != {"bytes": len(body), "content_hash": _sha256(body)}:
            raise AttemptStateError(f"state artifact entry does not match its manifest: {name}")
    latest = _ledger_latest_from_bytes(files[LEDGER_NAME], now)
    if manifest.get("ledger_latest_attempted_at") != latest.isoformat():
        raise AttemptStateError("state manifest ledger time does not match the ledger")
    candidate_retrieved_at = _validate_candidate(files, now)
    return {
        "latest_attempted_at": latest,
        "candidate": {name: files[name] for name in (SCHEDULE_NAME, CHANGES_NAME) if name in files},
        "candidate_retrieved_at": candidate_retrieved_at,
        "manifest": manifest,
    }


def _trusted_run(run: object, identity: RunIdentity) -> bool:
    if not isinstance(run, dict):
        raise AttemptStateError("workflow run listing is malformed")
    repository = run.get("repository") or {}
    head_repository = run.get("head_repository") or {}
    return (
        isinstance(run.get("id"), int)
        and run.get("path") == identity.workflow_path
        and run.get("head_branch") == TRUSTED_BRANCH
        and run.get("event") in TRUSTED_EVENTS
        and isinstance(repository, dict)
        and repository.get("full_name") == identity.repository
        and isinstance(head_repository, dict)
        and head_repository.get("full_name") == identity.repository
    )


def _state_artifact(api: GitHubApi, identity: RunIdentity, run_id: int) -> dict | None:
    listing = api.get_json(
        f"repos/{identity.repository}/actions/runs/{run_id}/artifacts"
        f"?name={quote(STATE_ARTIFACT_NAME)}&per_page=10"
    )
    if not isinstance(listing, dict) or not isinstance(listing.get("artifacts"), list):
        raise AttemptStateError("artifact listing is malformed")
    usable = []
    for artifact in listing["artifacts"]:
        if not isinstance(artifact, dict) or artifact.get("name") != STATE_ARTIFACT_NAME:
            continue
        workflow_run = artifact.get("workflow_run")
        if not (
            isinstance(workflow_run, dict)
            and workflow_run.get("id") == run_id
            and workflow_run.get("head_branch") == TRUSTED_BRANCH
        ):
            raise AttemptStateError("state artifact does not belong to this main-branch run")
        if artifact.get("expired") is not False:
            continue
        if not isinstance(artifact.get("id"), int):
            raise AttemptStateError("state artifact listing is malformed")
        usable.append(artifact)
    if len(usable) > 1:
        raise AttemptStateError("a run has more than one live state artifact")
    return usable[0] if usable else None


def restore(
    *,
    api: GitHubApi,
    identity: RunIdentity,
    archive_dir: Path,
    candidate_dir: Path,
    work_dir: Path,
    now: datetime,
) -> dict[str, Any]:
    """Restore the newest trusted state and spend budget for any newer run without state."""

    workflow_file = identity.workflow_path.rsplit("/", 1)[-1]
    listing = api.get_json(
        f"repos/{identity.repository}/actions/workflows/{workflow_file}/runs"
        f"?branch={TRUSTED_BRANCH}&per_page={RUN_PAGE_SIZE}"
    )
    if not isinstance(listing, dict) or not isinstance(listing.get("workflow_runs"), list):
        raise AttemptStateError("workflow run listing is malformed")
    runs = [run for run in listing["workflow_runs"] if _trusted_run(run, identity)]
    runs.sort(key=lambda run: _parse_time(run.get("created_at"), "run created_at"), reverse=True)

    bounds: list[dict[str, Any]] = []
    restored: dict | None = None
    restored_run: int | None = None
    for run in runs:
        run_id = run["id"]
        if run_id == identity.run_id:
            if identity.run_attempt == 1:
                continue
            # a re-run: an earlier attempt of this run may have requested the source
            bound_field = "run_started_at"
        elif run.get("status") == "completed":
            bound_field = "updated_at"
        elif run.get("status") in QUEUED_STATUSES:
            continue
        else:
            raise AttemptStateError("another schedule run is in progress; refusing to collect")
        artifact = _state_artifact(api, identity, run_id)
        if artifact is not None:
            work_dir.mkdir(parents=True, exist_ok=True)
            destination = work_dir / f"state-{artifact['id']}.zip"
            api.download(
                f"repos/{identity.repository}/actions/artifacts/{artifact['id']}/zip",
                destination,
                MAX_ZIP_BYTES,
            )
            restored = read_state_zip(destination, run_id=run_id, identity=identity, now=now)
            restored_run = run_id
            break
        bound = _parse_time(run.get(bound_field), f"run {bound_field}")
        bounds.append(
            {
                "run_id": run_id,
                "field": bound_field,
                "upper_bound": _not_future(bound, now, f"run {bound_field}").isoformat(),
                "network_performed": "UNKNOWN",
            }
        )

    if restored is None and not bounds:
        raise AttemptStateError(
            "no trusted schedule state or run evidence exists; a fresh start is not permitted"
        )

    ledger = SourceAttemptLedger(archive_dir)
    try:
        existing = ledger.latest_attempted_at(SOURCE_ID, OPERATION)
    except (SourceAttemptLedgerError, ValueError) as error:
        raise AttemptStateError("local schedule ledger is malformed") from error
    times = [_parse_time(item["upper_bound"], "bound") for item in bounds]
    if existing is not None:
        times.append(_not_future(existing, now, "local schedule ledger attempt"))
    if restored is not None:
        times.append(restored["latest_attempted_at"])
    target = max(times)
    if existing is None or target > existing:
        ledger.record(SOURCE_ID, OPERATION, target)

    candidate_report: dict[str, Any] = {"status": "NONE"}
    if restored is not None and restored["candidate"]:
        candidate_dir.mkdir(parents=True, exist_ok=True)
        for name, body in restored["candidate"].items():
            (candidate_dir / name.rsplit("/", 1)[-1]).write_bytes(body)
        candidate_report = {
            "status": "VERIFIED_AND_RETAINED_ONLY",
            "retrieved_at": restored["candidate_retrieved_at"],
            "note": "kept with its original acquisition time; not republished as a new fetch",
        }
    return {
        "schema_version": "1",
        "status": "RESTORED" if restored is not None else "BOOTSTRAPPED_FROM_RUN_BOUNDS",
        "restored_from_run_id": restored_run,
        "restored_ledger_attempted_at": (
            restored["latest_attempted_at"].isoformat() if restored is not None else None
        ),
        "run_upper_bounds": bounds,
        "effective_last_attempted_at": target.isoformat(),
        "candidate": candidate_report,
        "network_collection_performed": False,
    }


# --- command line ---------------------------------------------------------------------------


def _identity(args: argparse.Namespace) -> RunIdentity:
    return RunIdentity(
        repository=args.repository,
        run_id=args.run_id,
        run_attempt=args.run_attempt,
        workflow_path=args.workflow_path,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("restore", "pack"):
        command = sub.add_parser(name)
        command.add_argument("--repository", required=True)
        command.add_argument("--workflow-path", default=WORKFLOW_PATH)
        command.add_argument("--run-id", type=int, required=True)
        command.add_argument("--run-attempt", type=int, required=True)
        command.add_argument("--archive-dir", type=Path, required=True)
        command.add_argument("--report", type=Path)
    restore_command = sub.choices["restore"]
    restore_command.add_argument("--candidate-dir", type=Path, required=True)
    restore_command.add_argument("--work-dir", type=Path, required=True)
    pack_command = sub.choices["pack"]
    pack_command.add_argument("--fetch-status", type=int, required=True)
    pack_command.add_argument("--schedule", type=Path, required=True)
    pack_command.add_argument("--changes", type=Path, required=True)
    pack_command.add_argument("--diagnostics-dir", type=Path)
    pack_command.add_argument("--previous-candidate-dir", type=Path)
    pack_command.add_argument("--output-dir", type=Path, required=True)
    return parser


def main(
    argv: list[str] | None = None,
    *,
    api: GitHubApi | None = None,
    clock: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> int:
    args = build_parser().parse_args(argv)
    now = clock()
    try:
        identity = _identity(args)
        if args.command == "restore":
            report = restore(
                api=api or GhCliApi(),
                identity=identity,
                archive_dir=args.archive_dir,
                candidate_dir=args.candidate_dir,
                work_dir=args.work_dir,
                now=now,
            )
            shutil.rmtree(args.work_dir, ignore_errors=True)
        else:
            report = pack(
                identity=identity,
                archive_dir=args.archive_dir,
                output_dir=args.output_dir,
                fetch_status=args.fetch_status,
                schedule=args.schedule,
                changes=args.changes,
                diagnostics_dir=args.diagnostics_dir,
                previous_candidate_dir=args.previous_candidate_dir,
                now=now,
            )
        code = 0
    except (AttemptStateError, SourceAttemptLedgerError, OSError) as error:
        report = {
            "schema_version": "1",
            "status": "ATTEMPT_STATE_BLOCKED",
            "command": args.command,
            "error": str(error),
            "network_collection_performed": False,
            "next_action": "REVIEW_SCHEDULE_ATTEMPT_STATE",
        }
        code = 2
    text = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.report is not None:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(text, encoding="utf-8")
    sys.stdout.write(text)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
