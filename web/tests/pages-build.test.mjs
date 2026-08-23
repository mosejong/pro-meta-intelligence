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
  assert.doesNotMatch(feedText, /C:\\\\Users|\.csv|chatgpt|openai|gpt login|sign in/i);
  assert.ok(card.byteLength > 10_000);
  assert.ok(hero.byteLength > 1_000_000);
});
