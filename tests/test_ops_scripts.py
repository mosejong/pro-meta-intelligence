import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

MINIMUM_SUPPORTED_ACTION_MAJORS = {
    "actions/checkout": 5,
    "actions/setup-node": 5,
    "actions/setup-python": 6,
    "actions/configure-pages": 6,
    "actions/upload-pages-artifact": 5,
    "actions/deploy-pages": 5,
    "actions/upload-artifact": 5,
}


def assert_action_major_at_least(workflow: str, action: str, minimum: int) -> None:
    majors = re.findall(rf"uses:\s*{re.escape(action)}@v(\d+)\b", workflow)
    assert majors, f"{action} is missing"
    assert all(int(major) >= minimum for major in majors), (
        f"{action} must use v{minimum} or newer; found {majors}"
    )


def test_github_workflows_avoid_deprecated_node20_action_runtimes() -> None:
    workflow = "\n".join(
        path.read_text(encoding="utf-8")
        for path in sorted((ROOT / ".github" / "workflows").glob("*.yml"))
    )

    for action, minimum in MINIMUM_SUPPORTED_ACTION_MAJORS.items():
        assert_action_major_at_least(workflow, action, minimum)


def test_isolated_publisher_has_an_eight_file_allowlist_and_no_force_push() -> None:
    script = (ROOT / "ops" / "windows" / "publish-oe-feed.ps1").read_text(encoding="utf-8")
    gitignore = (ROOT / ".gitignore").read_text(encoding="utf-8")

    assert '"web/public/feed/current.json"' in script
    assert '"web/public/feed/history-status.json"' in script
    assert '"web/public/feed/schedule.json"' in script
    assert '"web/public/feed/schedule-changes.json"' in script
    assert '"web/public/feed/current-creator.json"' in script
    assert '"web/public/feed/decision-outcomes.json"' in script
    assert '"web/public/feed/ai-validation.json"' in script
    assert '"web/public/feed/collection-status.json"' in script
    assert "!web/public/feed/collection-status.json" in gitignore
    assert "Publish eight allowlisted public feed artifacts" in script
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
    assert_action_major_at_least(workflow, "actions/upload-pages-artifact", 5)
    assert_action_major_at_least(workflow, "actions/deploy-pages", 5)
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
        "collection-status.json",
    ):
        assert artifact in workflow
    assert "curl --fail" in workflow
    assert "--retry 3" in workflow
    assert "--max-filesize 7000000" in workflow
    assert "check-publication-watchdog" in workflow
    assert "gh issue create" in workflow
    assert "gh issue edit" in workflow
    assert "gh issue close" in workflow
    assert_action_major_at_least(workflow, "actions/upload-artifact", 5)
    assert "retention-days: 14" in workflow
    assert "steps.health.outcome != 'success'" in workflow
    assert "git push" not in workflow


def test_hosted_oe_collector_restores_private_state_and_publishes_only_safe_heads() -> None:
    workflow = (ROOT / ".github" / "workflows" / "hosted-oe-sync.yml").read_text(encoding="utf-8")
    assert "--patch-selection-league LCK" in workflow
    assert "python ops/refresh_draft_scouts.py" in workflow
    assert "--feed web/public/feed/current.json" in workflow
    assert "if: steps.sync-health.outcome == 'success'" in workflow
    assert "web/app/scouting/t1-vs-(kc|tes|ig|gen|lyon|dk|blg)" in workflow
    refresh = workflow.split("name: Refresh scouting packs", 1)[1].split("- name:", 1)[0]
    assert "continue-on-error: true" in refresh
    assert "if: steps.scout-refresh.outcome == 'failure'" in workflow
    assert "git checkout -- web/app/scouting" in workflow
    for international_event in ("WLDs", "MSI", "FST"):
        assert f"--patch-selection-league {international_event}" in workflow

    history_path = "web/public/history/player-season-2026.json"
    history = workflow.split("name: Refresh season player history", 1)[1].split("- name:", 1)[0]
    assert "if: steps.sync-health.outcome == 'success'" in history
    assert "continue-on-error: true" in history
    assert "python ops/build_player_season_history.py" in history
    assert '--archive-dir "$PRIVATE_ARCHIVE_DIR"' in history
    assert f"--output {history_path}" in history
    assert "--season 2026" in history
    assert "if: steps.season-history-refresh.outcome == 'failure'" in workflow
    assert workflow.index("id: sync-health") < workflow.index("id: season-history-refresh")
    assert workflow.index("id: season-history-refresh") < workflow.index("npm run test:pages")
    assert "git checkout -- web/public/history" not in workflow
    assert "git clean -fdq -- web/public/history" not in workflow
    publish = workflow.split("name: Publish only the reviewed public feed heads", 1)[1]
    publish = publish.split("- name:", 1)[0]
    assert "web/public/history/player-season-2026\\.json|" in publish
    assert publish.count(history_path) == 2  # change check and git add
    for private in (
        "outputs/",
        "PRIVATE_ARCHIVE_DIR",
        ".meta.json",
        ".csv",
        "web/public/history/*",
    ):
        assert private not in publish

    assert 'cron: "13 1,7,13,19 * * *"' in workflow
    assert 'cron: "13 7 * * *"' not in workflow
    assert "SourceAttemptLedger" in (ROOT / "src/pro_meta_intelligence/cli.py").read_text(
        encoding="utf-8"
    )
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
    assert "oe-sync-diagnostics-${{ github.run_id }}" in workflow
    assert "Preserve public-safe sync diagnostics on success or rejection" in workflow
    diagnostics = workflow.split("Preserve public-safe sync diagnostics on success or rejection", 1)
    diagnostics = diagnostics[1].split("- name:", 1)[0]
    # Default runs still upload on success or rejection; only history-only mode is excluded.
    assert "if: ${{ always() && env.HISTORY_ONLY != 'true' }}" in diagnostics
    assert "outputs/oe-feed-jobs/latest.json" in workflow
    assert "if-no-files-found: warn" in workflow
    assert "retention-days: 14" in workflow
    assert "retention-days: 90" in workflow
    assert "compression-level: 0" in workflow
    assert "actions/artifacts/$artifact_id" in workflow
    assert "gh api --method DELETE" in workflow
    assert "git push origin HEAD:main" in workflow
    assert_action_major_at_least(workflow, "actions/deploy-pages", 5)
    assert "web/public/feed/current.json" in workflow
    assert "web/public/feed/current-creator.json" in workflow
    assert "web/public/feed/history-status.json" in workflow
    assert "web/public/feed/decision-outcomes.json" in workflow
    assert "web/public/feed/collection-status.json" in workflow
    assert "id: sync-health" in workflow
    assert "continue-on-error: true" in workflow
    assert "pages_ready: ${{ steps.pages-upload.outcome == 'success' }}" in workflow
    assert "Preserve failed collection health after publishing its public status" in workflow
    assert "always() && needs.sync.outputs.pages_ready == 'true'" in workflow
    assert "schedule.json" not in workflow
    assert "--force" not in workflow


def _workflow_step(workflow: str, name: str) -> str:
    assert workflow.count(f"- name: {name}\n") == 1, name
    return workflow.split(f"- name: {name}\n", 1)[1].split("\n      - ", 1)[0]


def test_normal_diagnostics_failure_cannot_skip_the_encrypted_ledger_repack() -> None:
    workflow = (ROOT / ".github" / "workflows" / "hosted-oe-sync.yml").read_text(encoding="utf-8")

    # The diagnostics upload is best-effort, exactly like the history-only diagnostics upload.
    # Its condition, destination and retention are unchanged; the only approved payload addition
    # (2026-11-20) is the standalone three-field snapshot manifest, as the fourth exact path.
    diagnostics = _workflow_step(
        workflow, "Preserve public-safe sync diagnostics on success or rejection"
    )
    assert diagnostics == (
        "        # Current-season only: in history mode a failure here would skip "
        "the encrypted repack.\n"
        "        if: ${{ always() && env.HISTORY_ONLY != 'true' }}\n"
        "        # A diagnostics upload failure must never prevent the attempt ledger "
        "from being repacked.\n"
        "        continue-on-error: true\n"
        "        uses: actions/upload-artifact@v7\n"
        "        with:\n"
        "          name: oe-sync-diagnostics-${{ github.run_id }}\n"
        "          path: |\n"
        "            outputs/hosted-oe-state/sync-report.json\n"
        "            outputs/hosted-oe-state/local-health.json\n"
        "            outputs/oe-feed-jobs/latest.json\n"
        "            outputs/hosted-oe-state/snapshot-manifest.json\n"
        "          if-no-files-found: warn\n"
        "          retention-days: 14"
    )
    uploaded = diagnostics.split("path: |\n", 1)[1].split("          if-no-files-found:", 1)[0]
    for forbidden in ("restore-report", "pack-report", ".pmi", "*", ".zip", "ledger", "cache"):
        assert forbidden not in uploaded
    history_diagnostics = _workflow_step(workflow, "Preserve history-only acquisition diagnostics")
    assert "continue-on-error: true" in history_diagnostics
    assert "snapshot-manifest" not in history_diagnostics

    # The manifest generator is normal-mode only, best-effort, needs a successful restore, reads
    # the existing restore report and writes only the standalone manifest, right before upload.
    generator = _workflow_step(workflow, "Write the approved three-field snapshot manifest")
    assert generator == (
        "        id: snapshot-manifest\n"
        "        # Approved 2026-11-20: export only content_hash, retrieved_at and byte_length "
        "per snapshot.\n"
        "        # Best-effort: a missing restore report (explicit fresh start) must never block "
        "the backup.\n"
        "        if: always() && env.HISTORY_ONLY != 'true' && "
        "steps.restore.outcome == 'success'\n"
        "        continue-on-error: true\n"
        "        run: >-\n"
        "          python ops/write_private_snapshot_manifest.py\n"
        '          --report "$PRIVATE_STATE_DIR/restore-report.json"\n'
        '          --output "$PRIVATE_STATE_DIR/snapshot-manifest.json"'
    )
    assert workflow.count("write_private_snapshot_manifest.py") == 1
    assert workflow.count("snapshot-manifest.json") == 2  # written once, uploaded once
    assert workflow.index("id: sync-health") < workflow.index("id: snapshot-manifest")
    generator_end = workflow.index("id: snapshot-manifest")
    upload_start = workflow.index("- name: Preserve public-safe sync diagnostics")
    assert "\n      - name: " not in workflow[generator_end:upload_start]

    # The repack and the encrypted-state upload that follow stay strict and unconditional.
    repack = _workflow_step(
        workflow, "Repack authenticated private history without publishing raw rows"
    )
    archive_upload = _workflow_step(workflow, "Upload redundant rolling private history state")
    retention = _workflow_step(workflow, "Keep the two newest encrypted history states")
    for strict_step in (repack, archive_upload, retention):
        assert "continue-on-error" not in strict_step
        assert "if:" not in strict_step
    assert "if-no-files-found: error" in archive_upload
    assert workflow.index("Preserve public-safe sync diagnostics") < workflow.index(
        "Repack authenticated private history"
    )

    # Source-health and publication-readiness gates are untouched.
    assert "if: steps.sync-health.outcome == 'success' && env.HISTORY_ONLY != 'true'" in workflow
    assert "pages_ready: ${{ steps.pages-upload.outcome == 'success' }}" in workflow
    failed_health = _workflow_step(
        workflow, "Preserve failed collection health after publishing its public status"
    )
    assert (
        "if: always() && steps.sync-health.outcome != 'success' && env.HISTORY_ONLY != 'true'"
        in failed_health
    )
    assert "continue-on-error" not in failed_health
    assert "exit 1" in failed_health
    for gate in (
        "Validate and build the independent Pages artifact",
        "Publish only the reviewed public feed heads",
    ):
        assert "continue-on-error" not in _workflow_step(workflow, gate)


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


def test_season_artifact_mode_is_read_only_and_exports_only_public_aggregates():
    workflow = (ROOT / ".github/workflows/refresh-draft-scout.yml").read_text(encoding="utf-8")
    assert "options: [scouting, season-artifact]" in workflow
    assert "if: inputs.refresh_scope != 'season-artifact'" in workflow
    job = workflow.split("  season-artifact:", 1)[1]
    assert "if: inputs.refresh_scope == 'season-artifact'" in job
    assert "actions: read" in job and "contents: read" in job
    assert "contents: write" not in job and "pull-requests: write" not in job
    assert "ref: ${{ github.sha }}" in job
    assert "python ops/build_player_season_history.py" in job
    assert "git push" not in job and "deploy-pages" not in job and "sync-oe-feed" not in job
    exported = job.split("name: Export only derived public aggregates", 1)[1]
    assert "player-season-2026.json" in exported and "manifest.json" in exported
    assert ".pmi" not in exported and ".csv" not in exported
    assert "if-no-files-found: error" in exported
