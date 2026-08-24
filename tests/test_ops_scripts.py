from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_isolated_publisher_has_a_three_file_allowlist_and_no_force_push() -> None:
    script = (ROOT / "ops" / "windows" / "publish-oe-feed.ps1").read_text(encoding="utf-8")

    assert '"web/public/feed/current.json"' in script
    assert '"web/public/feed/history-status.json"' in script
    assert '"web/public/feed/schedule.json"' in script
    assert "worktree add --detach --lock" in script
    assert 'push $RemoteName "HEAD:$PublishBranch"' in script
    assert "--force" not in script
    assert "status --porcelain" in script
    assert "Unexpected staged paths" in script


def test_scheduled_runner_requires_an_explicit_publish_switch() -> None:
    runner = (ROOT / "ops" / "windows" / "run-oe-sync.ps1").read_text(encoding="utf-8")
    register = (ROOT / "ops" / "windows" / "register-oe-sync-task.ps1").read_text(encoding="utf-8")

    assert "[switch]$Publish" in runner
    assert "if ($Publish" in runner
    assert "[switch]$EnablePublish" in register
    assert "if ($EnablePublish)" in register
    assert '"fetch-schedule"' in runner
    assert '"--league", "lck"' in runner


def test_windows_scripts_resolve_the_default_root_after_parameter_binding() -> None:
    for relative_path in (
        "ops/windows/publish-oe-feed.ps1",
        "ops/windows/run-oe-sync.ps1",
        "ops/windows/register-oe-sync-task.ps1",
    ):
        script = (ROOT / relative_path).read_text(encoding="utf-8")
        assert '[string]$RepositoryRoot = ""' in script
        assert "if (-not $RepositoryRoot)" in script
        assert "[string]$RepositoryRoot = (Resolve-Path" not in script
