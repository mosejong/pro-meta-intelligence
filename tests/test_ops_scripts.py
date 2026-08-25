from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_isolated_publisher_has_a_four_file_allowlist_and_no_force_push() -> None:
    script = (ROOT / "ops" / "windows" / "publish-oe-feed.ps1").read_text(encoding="utf-8")

    assert '"web/public/feed/current.json"' in script
    assert '"web/public/feed/history-status.json"' in script
    assert '"web/public/feed/schedule.json"' in script
    assert '"web/public/feed/schedule-changes.json"' in script
    assert '"web/public/feed/current-creator.json"' in script
    assert "Publish five allowlisted public feed artifacts" in script
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
    assert '"--changes-output", $scheduleChangesOutput' in runner
    assert '"--watch-team", "T1"' in runner


def test_github_schedule_refresh_respects_policy_interval_and_narrow_publish_scope() -> None:
    workflow = (ROOT / ".github" / "workflows" / "schedule-refresh.yml").read_text(encoding="utf-8")

    assert 'cron: "17 */8 * * *"' in workflow
    assert "contents: write" in workflow
    assert "pages: write" in workflow
    assert "id-token: write" in workflow
    assert "cancel-in-progress: false" in workflow
    assert "--watch-team T1" in workflow
    assert 'if [ "$status" -eq 3 ]' in workflow
    assert "web/public/feed/schedule.json" in workflow
    assert "web/public/feed/schedule-changes.json" in workflow
    assert "git push origin HEAD:main" in workflow
    assert "actions/upload-pages-artifact@v3" in workflow
    assert "actions/deploy-pages@v4" in workflow
    assert "--force" not in workflow


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
