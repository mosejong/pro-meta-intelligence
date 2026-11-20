import ast
import json
import textwrap
from pathlib import Path

import pytest

WORKFLOW = Path(__file__).resolve().parents[1] / ".github/workflows/cached-history-audit.yml"
CARD_STEPS = (
    "Confirm requested year admission before card generation",
    "Build review-only season cards offline from restored archive",
    "Preserve review-only season cards",
)


def _workflow() -> str:
    return WORKFLOW.read_text(encoding="utf-8")


def _step(workflow: str, name: str) -> str:
    body = workflow.split(f"      - name: {name}\n", 1)[1]
    return body.split("\n      - ", 1)[0]


def _admission_program(workflow: str) -> str:
    step = _step(workflow, CARD_STEPS[0])
    return textwrap.dedent(
        step.split("python - <<'ADMISSION'\n", 1)[1].rsplit("\n          ADMISSION", 1)[0]
    )


def test_build_cards_is_optional_manual_boolean_defaulting_false():
    workflow = _workflow()
    on = workflow.split("on:\n", 1)[1].split("\npermissions:", 1)[0]
    assert on.lstrip().startswith("workflow_dispatch:")
    assert "schedule" not in on and "push" not in on
    build = on.split("      build_cards:\n", 1)[1]
    assert "required: false" in build
    assert "default: false" in build
    assert "type: boolean" in build
    permissions = workflow.split("permissions:\n", 1)[1].split("\nconcurrency:", 1)[0]
    assert "write" not in permissions


def test_card_steps_run_only_when_selected_and_after_audit_success():
    workflow = _workflow()
    positions = [workflow.index(f"- name: {name}") for name in CARD_STEPS]
    audit_upload = workflow.index("- name: Preserve aggregate diagnostic reports only")
    assert audit_upload < positions[0] < positions[1] < positions[2]
    for name in CARD_STEPS:
        assert "if: ${{ success() && inputs.build_cards }}" in _step(workflow, name)
    # The inputs value must never be interpolated directly into shell code.
    for name in CARD_STEPS[:2]:
        run = _step(workflow, name).split("run: |", 1)[1]
        assert "${{" not in run
    # Existing audit report upload is unchanged and still unconditional.
    audit = _step(workflow, "Preserve aggregate diagnostic reports only")
    assert "if: always()" in audit
    assert "cached-season-cards" not in audit


def test_builder_runs_offline_with_restored_archive_and_fixed_paths():
    workflow = _workflow()
    run = _step(workflow, CARD_STEPS[1])
    assert "python -m ops.build_season_player_cards" in run
    assert "--archive-dir outputs/private-audit-state/raw" in run
    assert "--feed web/public/feed/current.json" in run
    assert "--candidate-season 2022" in run
    assert '--candidate-season "$AUDIT_YEAR"' in run
    assert '--output "$out/season-player-cards.json"' in run
    assert "out=outputs/cached-season-cards" in run
    assert 'mv "$out/build-report.partial" "$out/build-report.json"' in run
    for forbidden in (
        "fetch-oe",
        "sync-oe-feed",
        "hosted_history_acquisition",
        "pack-private-oe-archive",
        "git ",
        "deploy-pages",
        "web/public/history",
        "OE_ARCHIVE_KEY",
        "GH_TOKEN",
        "curl",
    ):
        assert forbidden not in run


def test_card_artifact_uploads_exactly_two_files_for_fourteen_days():
    workflow = _workflow()
    upload = _step(workflow, CARD_STEPS[2])
    assert "uses: actions/upload-artifact@" in upload
    paths = upload.split("path: |\n", 1)[1].split("if-no-files-found:", 1)[0].split()
    assert paths == [
        "outputs/cached-season-cards/season-player-cards.json",
        "outputs/cached-season-cards/build-report.json",
    ]
    assert "retention-days: 14" in upload
    assert "if-no-files-found: error" in upload


@pytest.mark.parametrize(
    ("report", "admitted"),
    [
        ({"requested_years": [2015], "years": [{"season": 2015, "status": "USABLE"}]}, True),
        (
            {
                "requested_years": [2015],
                "years": [{"season": 2015, "status": "USABLE_WITH_REJECTIONS"}],
            },
            True,
        ),
        (
            {"requested_years": [2015], "years": [{"season": 2015, "status": "BLOCKED_INTEGRITY"}]},
            False,
        ),
        ({"requested_years": [2015], "years": []}, False),
        ({"requested_years": [2016], "years": [{"season": 2016, "status": "USABLE"}]}, False),
        (
            {
                "requested_years": [2015],
                "years": [
                    {"season": 2015, "status": "USABLE"},
                    {"season": 2015, "status": "USABLE"},
                ],
            },
            False,
        ),
    ],
)
def test_admission_gate_requires_usable_requested_year(
    tmp_path, monkeypatch, capsys, report, admitted
):
    program = _admission_program(_workflow())
    ast.parse(program)
    target = tmp_path / "outputs/cached-history-audit/admission.json"
    target.parent.mkdir(parents=True)
    target.write_text(json.dumps(report), encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("AUDIT_YEAR", "2015")
    if admitted:
        exec(compile(program, "<admission-gate>", "exec"), {})
        assert json.loads(capsys.readouterr().out)["season"] == 2015
    else:
        with pytest.raises(SystemExit):
            exec(compile(program, "<admission-gate>", "exec"), {})
