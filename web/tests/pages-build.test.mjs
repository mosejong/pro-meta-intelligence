import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../dist-pages/", import.meta.url);

test("builds direct-loadable onboarding and field pages", async () => {
  const pages = [
    ["index.html", "Pro Meta Intelligence · 공개 팀 분석 플랫폼"],
    ["team/index.html", "팀 분석 · Pro Meta Intelligence"],
    ["t1/index.html", "T1 브리프 · Pro Meta Intelligence"],
    ["creator/index.html", "Creator Studio · Pro Meta Intelligence"],
    ["radar/index.html", "Meta Radar · Pro Meta Intelligence"],
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
  const feedText = await readFile(new URL("feed/current.json", root), "utf8");
  const feed = JSON.parse(feedText);
  const historyText = await readFile(new URL("feed/history-status.json", root), "utf8");
  const history = JSON.parse(historyText);
  const outcomesText = await readFile(new URL("feed/decision-outcomes.json", root), "utf8");
  const outcomes = JSON.parse(outcomesText);
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
  assert.equal(feed.patch_id, "16.16");
  assert.equal(feed.publication_readiness.ready_for_radar, true);
  assert.ok(Number.isInteger(
    feed.publication_readiness.selected_patch_import_quality.known_exclusion_game_count,
  ));
  assert.ok(feed.publication_readiness.selected_patch_import_quality.known_exclusion_game_count >= 0);
  assert.ok(feed.entries.length > 0);
  assert.equal(history.artifact_type, "oe-history-status");
  assert.equal(history.schema_version, "1");
  assert.equal(history.gates.length, 4);
  assert.equal(history.aggregate, null);
  assert.deepEqual(feed.history_status, history);
  assert.equal(outcomes.artifact_type, "team-decision-outcomes");
  assert.equal(outcomes.as_of, history.as_of);
  assert.equal(outcomes.benchmark_ready, history.benchmark_ready);
  assert.deepEqual(outcomes.evaluations, []);
  assert.equal(schedule.artifact_type, "pro-schedule-snapshot");
  assert.ok(schedule.events.length > 0);
  assert.equal(scheduleChanges.artifact_type, "pro-schedule-change-log");
  assert.equal(scheduleChanges.watched_team, "T1");
  assert.equal(scheduleChanges.current_snapshot.content_hash, schedule.content_hash);
  assert.equal(creator.mode, "CREATOR");
  assert.equal(creator.source_snapshot.patch_id, feed.patch_id);
  assert.equal(creator.source_snapshot.cutoff, feed.cutoff);
  assert.equal(creator.human_review_required, true);
  assert.ok(creator.topic_candidates.length > 0);
  assert.doesNotMatch(feedText, /C:\\\\Users|\.csv|chatgpt|openai|gpt login|sign in/i);
  assert.doesNotMatch(historyText, /C:\\\\Users|\.csv|chatgpt|openai|gpt login|sign in/i);
  assert.doesNotMatch(outcomesText, /C:\\\\Users|\.csv|chatgpt|openai|gpt login|sign in/i);
  assert.doesNotMatch(scheduleText, /C:\\\\Users|\.csv|chatgpt|openai|gpt login|sign in/i);
  assert.doesNotMatch(scheduleChangesText, /C:\\\\Users|\.csv|chatgpt|openai|gpt login|sign in/i);
  assert.doesNotMatch(creatorText, /C:\\\\Users|\.csv|chatgpt|openai|gpt login|sign in/i);
  assert.ok(card.byteLength > 10_000);
  assert.ok(hero.byteLength > 1_000_000);
});
