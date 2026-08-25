from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_isolated_publisher_has_a_seven_file_allowlist_and_no_force_push() -> None:
    script = (ROOT / "ops" / "windows" / "publish-oe-feed.ps1").read_text(encoding="utf-8")

    assert '"web/public/feed/current.json"' in script
    assert '"web/public/feed/history-status.json"' in script
    assert '"web/public/feed/schedule.json"' in script
    assert '"web/public/feed/schedule-changes.json"' in script
    assert '"web/public/feed/current-creator.json"' in script
    assert '"web/public/feed/decision-outcomes.json"' in script
    assert '"web/public/feed/ai-validation.json"' in script
    assert "Publish seven allowlisted public feed artifacts" in script
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


def test_production_watchdog_checks_live_publication_and_reconciles_one_incident() -> None:
    workflow = (ROOT / ".github" / "workflows" / "production-watchdog.yml").read_text(
        encoding="utf-8"
    )

    assert 'cron: "43 */6 * * *"' in workflow
    assert "contents: read" in workflow
    assert "issues: write" in workflow
    assert "cancel-in-progress: false" in workflow
    assert "timeout-minutes: 10" in workflow
    assert "mosejong.github.io/pro-meta-intelligence/feed" in workflow
    for artifact in (
        "current.json",
        "current-creator.json",
        "history-status.json",
        "decision-outcomes.json",
        "schedule.json",
    ):
        assert artifact in workflow
    assert "curl --fail" in workflow
    assert "--retry 3" in workflow
    assert "--max-filesize 7000000" in workflow
    assert "check-publication-watchdog" in workflow
    assert "gh issue create" in workflow
    assert "gh issue edit" in workflow
    assert "gh issue close" in workflow
    assert "actions/upload-artifact@v4" in workflow
    assert "retention-days: 14" in workflow
    assert "steps.health.outcome != 'success'" in workflow
    assert "git push" not in workflow


def test_hosted_oe_collector_restores_private_state_and_publishes_only_safe_heads() -> None:
    workflow = (ROOT / ".github" / "workflows" / "hosted-oe-sync.yml").read_text(encoding="utf-8")

    assert 'cron: "13 7,19 * * *"' in workflow
    assert "actions: write" in workflow
    assert "contents: write" in workflow
    assert "pages: write" in workflow
    assert "id-token: write" in workflow
    assert "cancel-in-progress: false" in workflow
    assert "timeout-minutes: 30" in workflow
    assert "secrets.OE_ARCHIVE_KEY" in workflow
    assert "bootstrap_asset_id" in workflow
    assert "allow_fresh_start" in workflow
    assert "restore-private-oe-archive" in workflow
    assert "sync-oe-feed" in workflow
    assert "check-oe-feed-health" in workflow
    assert "pack-private-oe-archive" in workflow
    assert "oe-private-history-state-${{ github.run_id }}" in workflow
    assert "retention-days: 90" in workflow
    assert "compression-level: 0" in workflow
    assert "actions/artifacts/$artifact_id" in workflow
    assert "gh api --method DELETE" in workflow
    assert "git push origin HEAD:main" in workflow
    assert "actions/deploy-pages@v4" in workflow
    assert "web/public/feed/current.json" in workflow
    assert "web/public/feed/current-creator.json" in workflow
    assert "web/public/feed/history-status.json" in workflow
    assert "web/public/feed/decision-outcomes.json" in workflow
    assert "schedule.json" not in workflow
    assert "--force" not in workflow


def test_hosted_archive_bootstrap_never_prints_or_persists_the_generated_key() -> None:
    script = (ROOT / "ops" / "windows" / "bootstrap-hosted-oe-archive.ps1").read_text(
        encoding="utf-8"
    )

    assert '[string]$RepositoryRoot = ""' in script
    assert "ShouldProcess" in script
    assert "RandomNumberGenerator" in script
    assert "pack-private-oe-archive" in script
    assert "gh secret set" in script
    assert 'gh api --method GET "repos/$Repository/releases?per_page=100"' in script
    assert "$releaseListJson | ConvertFrom-Json" in script
    assert 'gh api --method POST "repos/$Repository/releases"' in script
    assert "-F draft=true" in script
    assert "https://uploads.github.com" in script
    assert "$assetJson | ConvertFrom-Json" in script
    assert '$asset.name -ne "oe-private-history-bootstrap.pmi"' in script
    assert 'gh api --method DELETE "repos/$Repository/releases/$releaseId"' in script
    assert "gh release upload" not in script
    assert "Remove-Item Env:OE_ARCHIVE_KEY" in script
    assert "[Array]::Clear" in script
    assert "Write-Output $key" not in script
    assert "Write-Host $key" not in script


def test_windows_scripts_resolve_the_default_root_after_parameter_binding() -> None:
    for relative_path in (
        "ops/windows/publish-oe-feed.ps1",
        "ops/windows/run-oe-sync.ps1",
        "ops/windows/register-oe-sync-task.ps1",
        "ops/windows/bootstrap-hosted-oe-archive.ps1",
    ):
        script = (ROOT / relative_path).read_text(encoding="utf-8")
        assert '[string]$RepositoryRoot = ""' in script
        assert "if (-not $RepositoryRoot)" in script
        assert "[string]$RepositoryRoot = (Resolve-Path" not in script
