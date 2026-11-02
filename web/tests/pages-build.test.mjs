import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../dist-pages/", import.meta.url);

function assertCreatorCandidates(creator, feed) {
  assert.equal(creator.mode, "CREATOR");
  assert.equal(creator.source_snapshot.patch_id, feed.patch_id);
  assert.equal(creator.source_snapshot.cutoff, feed.cutoff);
  assert.equal(creator.human_review_required, true);
  assert.equal(creator.publication_ready, false);
  assert.ok(Array.isArray(creator.topic_candidates));
  const eligible = new Set(feed.entries.filter((entry) => entry.eligible_for_review)
    .map((entry) => `${entry.champion_id}:${entry.role}`));
  if (eligible.size === 0) {
    assert.equal(creator.topic_candidates.length, 0);
    assert.ok(creator.warnings?.includes("NO_ELIGIBLE_CANDIDATES"));
  } else {
    assert.ok(creator.topic_candidates.length > 0);
    assert.ok(!creator.warnings?.includes("NO_ELIGIBLE_CANDIDATES"));
    const seen = new Set();
    for (const topic of creator.topic_candidates) {
      assert.equal(topic.candidate_id, `${topic.champion_id}:${topic.role}`);
      assert.ok(eligible.has(topic.candidate_id));
      assert.ok(!seen.has(topic.candidate_id));
      seen.add(topic.candidate_id);
      assert.equal(topic.review_state, "HUMAN_REVIEW_REQUIRED");
    }
  }
}

test("creator publication accepts intentional abstention but rejects missing or unsupported candidates", async () => {
  const feed = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
  const creator = JSON.parse(await readFile(new URL("../public/feed/current-creator.json", import.meta.url), "utf8"));
  assertCreatorCandidates(creator, feed);
  const noEligible = { ...feed, entries: feed.entries.map((entry) => ({ ...entry, eligible_for_review: false })) };
  const empty = { ...creator, topic_candidates: [], warnings: ["NO_ELIGIBLE_CANDIDATES"] };
  assert.doesNotThrow(() => assertCreatorCandidates(empty, noEligible));
  assert.throws(() => assertCreatorCandidates({ ...empty, warnings: [] }, noEligible));
  assert.throws(() => assertCreatorCandidates({ ...empty, publication_ready: true }, noEligible));
  assert.throws(() => assertCreatorCandidates({ ...empty, topic_candidates: null }, noEligible));
  const eligibleFeed = { ...feed, entries: [{ champion_id: "Ahri", role: "MID", eligible_for_review: true }] };
  assert.throws(() => assertCreatorCandidates(empty, eligibleFeed));
  const topic = { candidate_id: "Ahri:MID", champion_id: "Ahri", role: "MID", review_state: "HUMAN_REVIEW_REQUIRED" };
  const populated = { ...creator, warnings: [], topic_candidates: [topic] };
  assert.doesNotThrow(() => assertCreatorCandidates(populated, eligibleFeed));
  assert.throws(() => assertCreatorCandidates(populated, noEligible));
  assert.throws(() => assertCreatorCandidates({ ...populated, topic_candidates: [topic, topic] }, eligibleFeed));
  assert.throws(() => assertCreatorCandidates({ ...empty, source_snapshot: { ...empty.source_snapshot, patch_id: "wrong" } }, noEligible));
});

test("builds direct-loadable onboarding and field pages", async () => {
  const pages = [
    ["index.html", "Pro Meta Intelligence · 공개 팀 분석 플랫폼"],
    ["team/index.html", "팀 분석 · Pro Meta Intelligence"],
    ["t1/index.html", "T1 브리프 · Pro Meta Intelligence"],
    ["creator/index.html", "Creator Studio · Pro Meta Intelligence"],
    ["radar/index.html", "Meta Radar · Pro Meta Intelligence"],
    ["draft/index.html", "Draft Lab · Pro Meta Intelligence"],
    ["proof/index.html", "제출 증거 · Pro Meta Intelligence"],
  ];

  for (const [path, title] of pages) {
    const html = await readFile(new URL(path, root), "utf8");
    assert.match(html, new RegExp(`<title>${title}<\\/title>`));
    assert.match(html, /mosejong\.github\.io\/pro-meta-intelligence\/meta-radar-hero-v2\.png/);
    assert.match(html, /\/pro-meta-intelligence\/assets\/main-[^"']+\.js/);
    assert.doesNotMatch(html, /chatgpt|openai|gpt login|sign in/i);
  }
});

test("copies the same-origin feed and social card", async () => {
  const brief = await readFile(new URL("briefs/worlds-strategy-brief.pdf", root));
  assert.equal(brief.subarray(0, 5).toString(), "%PDF-");
  assert.deepEqual(brief, await readFile(new URL("../public/briefs/worlds-strategy-brief.pdf", import.meta.url)));
  const feedText = await readFile(new URL("feed/current.json", root), "utf8");
  const feed = JSON.parse(feedText);
  const collectionStatusText = await readFile(new URL("feed/collection-status.json", root), "utf8");
  const collectionStatus = JSON.parse(collectionStatusText);
  const historyText = await readFile(new URL("feed/history-status.json", root), "utf8");
  const history = JSON.parse(historyText);
  const outcomesText = await readFile(new URL("feed/decision-outcomes.json", root), "utf8");
  const outcomes = JSON.parse(outcomesText);
  const aiValidationText = await readFile(new URL("feed/ai-validation.json", root), "utf8");
  const aiValidation = JSON.parse(aiValidationText);
  const scheduleText = await readFile(new URL("feed/schedule.json", root), "utf8");
  const schedule = JSON.parse(scheduleText);
  const scheduleChangesText = await readFile(new URL("feed/schedule-changes.json", root), "utf8");
  const scheduleChanges = JSON.parse(scheduleChangesText);
  const creatorText = await readFile(new URL("feed/current-creator.json", root), "utf8");
  const creator = JSON.parse(creatorText);
  const card = await readFile(new URL("og.png", root));
  const hero = await readFile(new URL("meta-radar-hero-v2.png", root));

  assert.equal(feed.schema_version, "1");
  assert.equal(feed.fixture_only, false);
  const sourceFeed = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
  assert.deepEqual(feed, sourceFeed);
  assert.equal(feed.patch_id, feed.publication_readiness.selected_patch_id);
  assert.equal(feed.publication_readiness.ready_for_radar, true);
  assert.ok(Number.isInteger(
    feed.publication_readiness.selected_patch_import_quality.known_exclusion_game_count,
  ));
  assert.ok(feed.publication_readiness.selected_patch_import_quality.known_exclusion_game_count >= 0);
  assert.ok(feed.entries.length > 0);
  assert.equal(collectionStatus.artifact_type, "oe-collection-status");
  assert.equal(collectionStatus.schema_version, "1");
  assert.ok([
    "CURRENT",
    "SOURCE_DELAYED",
    "SOURCE_UNAVAILABLE",
    "PUBLICATION_REJECTED",
    "RUN_FAILED",
    "UNKNOWN",
  ].includes(collectionStatus.state));
  assert.ok([
    "NONE",
    "PROVIDER_QUOTA_OR_HTML_RESPONSE",
    "PROVIDER_SCHEMA_REJECTED",
    "PROVIDER_REQUEST_FAILED",
    "POLICY_INTERVAL_ACTIVE_AFTER_SOURCE_ERROR",
    "READINESS_GATE_REJECTED",
    "COLLECTOR_JOB_FAILED",
    "UNKNOWN_RESULT",
  ].includes(collectionStatus.reason_code));
  assert.equal(collectionStatus.automation.retry_mode, "AUTOMATIC_POLICY_GATED");
  assert.equal(history.artifact_type, "oe-history-status");
  assert.equal(history.schema_version, "1");
  assert.equal(history.gates.length, 4);
  assert.equal(history.aggregate, null);
  assert.deepEqual(feed.history_status, history);
  assert.equal(outcomes.artifact_type, "team-decision-outcomes");
  assert.equal(outcomes.as_of, history.as_of);
  assert.equal(outcomes.benchmark_ready, history.benchmark_ready);
  assert.deepEqual(outcomes.evaluations, []);
  assert.equal(aiValidation.artifact_type, "ai-human-validation-status");
  assert.equal(aiValidation.task_type, "EVIDENCE_LOCKED_BRIEF");
  assert.equal(aiValidation.status, "NOT_VALIDATED");
  assert.equal(aiValidation.ai_features_enabled, false);
  assert.equal(aiValidation.paired_holdout_case_count, 0);
  assert.equal(aiValidation.gates.length, 8);
  assert.equal(schedule.artifact_type, "pro-schedule-snapshot");
  assert.ok(schedule.events.length > 0);
  assert.equal(scheduleChanges.artifact_type, "pro-schedule-change-log");
  assert.equal(scheduleChanges.watched_team, "T1");
  assert.equal(scheduleChanges.current_snapshot.content_hash, schedule.content_hash);
  assertCreatorCandidates(creator, feed);
  assert.deepEqual(creator, JSON.parse(await readFile(new URL("../public/feed/current-creator.json", import.meta.url), "utf8")));
  assert.doesNotMatch(feedText, /C:\\\\Users|\.csv|chatgpt|openai|gpt login|sign in/i);
  assert.doesNotMatch(collectionStatusText, /C:\\\\Users|\.csv|chatgpt|openai|gpt login|sign in/i);
  assert.doesNotMatch(historyText, /C:\\\\Users|\.csv|chatgpt|openai|gpt login|sign in/i);
  assert.doesNotMatch(outcomesText, /C:\\\\Users|\.csv|chatgpt|openai|gpt login|sign in/i);
  assert.doesNotMatch(aiValidationText, /C:\\\\Users|\.csv|chatgpt|openai|gpt login|sign in/i);
  assert.doesNotMatch(scheduleText, /C:\\\\Users|\.csv|chatgpt|openai|gpt login|sign in/i);
  assert.doesNotMatch(scheduleChangesText, /C:\\\\Users|\.csv|chatgpt|openai|gpt login|sign in/i);
  assert.doesNotMatch(creatorText, /C:\\\\Users|\.csv|chatgpt|openai|gpt login|sign in/i);
  assert.ok(card.byteLength > 10_000);
  assert.ok(hero.byteLength > 1_000_000);
});
