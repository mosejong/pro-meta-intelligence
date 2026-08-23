import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../dist-pages/", import.meta.url);

test("builds an independent static Meta Radar entry page", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");

  assert.match(html, /<title>Meta Radar · Pro Meta Intelligence<\/title>/);
  assert.match(html, /mosejong\.github\.io\/pro-meta-intelligence\/og\.png/);
  assert.match(html, /\/pro-meta-intelligence\/assets\/index-[^"']+\.js/);
  assert.doesNotMatch(html, /chatgpt|openai|gpt login|sign in/i);
});

test("copies the same-origin feed and social card", async () => {
  const feed = JSON.parse(await readFile(new URL("feed/current.json", root), "utf8"));
  const card = await readFile(new URL("og.png", root));

  assert.equal(feed.schema_version, "1");
  assert.equal(feed.fixture_only, true);
  assert.ok(feed.entries.length > 0);
  assert.ok(card.byteLength > 10_000);
});
