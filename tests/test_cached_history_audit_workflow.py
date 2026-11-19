import ast
import textwrap
from pathlib import Path

WORKFLOW = Path(__file__).resolve().parents[1] / ".github/workflows/cached-history-audit.yml"


def test_cached_audit_cannot_collect_or_publish():
    workflow = WORKFLOW.read_text(encoding="utf-8")
    permissions = workflow.split("permissions:\n", 1)[1].split("\nconcurrency:", 1)[0]
    assert "contents: read" in permissions and "actions: read" in permissions
    assert "write" not in permissions
    assert "\n  schedule:" not in workflow
    for operation in (
        "fetch-oe",
        "sync-oe-feed",
        "hosted_history_acquisition",
        "git push",
        "deploy-pages",
    ):
        assert operation not in workflow
    assert "restore-private-oe-archive" in workflow
    assert "ops/audit_player_career_archive.py" in workflow


def test_only_reports_are_uploaded_and_inline_validation_compiles():
    workflow = WORKFLOW.read_text(encoding="utf-8")
    upload = workflow.split("          path: |\n", 1)[1].split("          if-no-files-found:", 1)[0]
    assert upload.split() == [
        "outputs/cached-history-audit/admission.json",
        "outputs/cached-history-audit/restore-report.json",
    ]
    program = workflow.split("python - <<'PY'\n", 1)[1].split("          PY\n", 1)[0]
    ast.parse(textwrap.dedent(program))
