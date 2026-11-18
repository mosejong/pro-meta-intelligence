"""Independent least-privilege and publication routing checks for schedule state."""

from pathlib import Path


def test_state_restore_has_the_github_actions_read_permission_it_requires():
    workflow = (
        Path(__file__).resolve().parents[1] / ".github/workflows/schedule-refresh.yml"
    ).read_text(encoding="utf-8")
    permissions = workflow.split("\npermissions:\n", 1)[1].split("\nconcurrency:", 1)[0]
    assert "actions: read" in permissions


def test_deploy_requires_a_new_accepted_schedule_candidate():
    workflow = (
        Path(__file__).resolve().parents[1] / ".github/workflows/schedule-refresh.yml"
    ).read_text(encoding="utf-8")
    deploy = workflow.split("\n  deploy:\n", 1)[1]
    assert "needs.refresh.outputs.publish == 'true'" in deploy
