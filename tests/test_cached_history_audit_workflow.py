import ast
import io
import stat
import textwrap
import zipfile
from pathlib import Path

import pytest

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


def test_real_collector_envelope_is_accepted_but_raw_and_duplicate_entries_are_not():
    workflow = WORKFLOW.read_text(encoding="utf-8")
    program = workflow.split("python - <<'PY'\n", 1)[1].split("          PY\n", 1)[0]
    tree = ast.parse(textwrap.dedent(program))
    function = next(
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "encrypted_entry"
    )
    namespace = {"stat": stat, "limit": 512 * 1024 * 1024}
    exec(
        compile(ast.Module(body=[function], type_ignores=[]), "<zip-validator>", "exec"), namespace
    )

    def check(names):
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as output:
            for name in names:
                output.writestr(name, b"fixture")
        with zipfile.ZipFile(data) as source:
            return namespace["encrypted_entry"](source).filename

    encrypted = "oe-private-history-state.pmi"
    assert check([encrypted, "pack-report.json", "restore-report.json"]) == encrypted
    assert check([encrypted, "local-health.json"]) == encrypted
    for unexpected in ("raw.csv", "../pack-report.json", "extra.json"):
        with pytest.raises(SystemExit):
            check([encrypted, unexpected])
    with pytest.warns(UserWarning), pytest.raises(SystemExit):
        check([encrypted, encrypted])
