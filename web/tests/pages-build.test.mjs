import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../dist-pages/", import.meta.url);

test("builds an independent static Meta Radar entry page", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");

  assert.match(html, /<title>Meta Radar · Pro Meta Intelligence<\/title>/);
  assert.match(html, /mosejong\.github\.io\/pro-meta-intelligence\/meta-radar-hero-v2\.png/);
  assert.match(html, /\/pro-meta-intelligence\/assets\/index-[^"']+\.js/);
  assert.doesNotMatch(html, /chatgpt|openai|gpt login|sign in/i);
});

test("copies the same-origin feed and social card", async () => {
  const feedText = await readFile(new URL("feed/current.json", root), "utf8");
  const feed = JSON.parse(feedText);
  const historyText = await readFile(new URL("feed/history-status.json", root), "utf8");
  const history = JSON.parse(historyText);
  const scheduleText = await readFile(new URL("feed/schedule.json", root), "utf8");
  const schedule = JSON.parse(scheduleText);
  const scheduleChangesText = await readFile(new URL("feed/schedule-changes.json", root), "utf8");
  const scheduleChanges = JSON.parse(scheduleChangesText);
  const card = await readFile(new URL("og.png", root));
  const hero = await readFile(new URL("meta-radar-hero-v2.png", root));

  assert.equal(feed.schema_version, "1");
  assert.equal(feed.fixture_only, false);
  assert.equal(feed.patch_id, "16.16");
  assert.equal(feed.publication_readiness.ready_for_radar, true);
  assert.equal(
    feed.publication_readiness.selected_patch_import_quality.known_exclusion_game_count,
    24,
  );
  assert.ok(feed.entries.length > 0);
  assert.equal(history.artifact_type, "oe-history-status");
  assert.equal(history.schema_version, "1");
  assert.equal(history.gates.length, 4);
  assert.equal(history.aggregate, null);
  assert.deepEqual(feed.history_status, history);
  assert.equal(schedule.artifact_type, "pro-schedule-snapshot");
  assert.ok(schedule.events.length > 0);
  assert.equal(scheduleChanges.artifact_type, "pro-schedule-change-log");
  assert.equal(scheduleChanges.watched_team, "T1");
  assert.equal(scheduleChanges.current_snapshot.content_hash, schedule.content_hash);
  assert.doesNotMatch(feedText, /C:\\\\Users|\.csv|chatgpt|openai|gpt login|sign in/i);
  assert.doesNotMatch(historyText, /C:\\\\Users|\.csv|chatgpt|openai|gpt login|sign in/i);
  assert.doesNotMatch(scheduleText, /C:\\\\Users|\.csv|chatgpt|openai|gpt login|sign in/i);
  assert.doesNotMatch(scheduleChangesText, /C:\\\\Users|\.csv|chatgpt|openai|gpt login|sign in/i);
  assert.ok(card.byteLength > 10_000);
  assert.ok(hero.byteLength > 1_000_000);
});
