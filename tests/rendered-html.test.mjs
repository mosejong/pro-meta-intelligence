import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`https://meta-radar.example${path}`, {
      headers: { accept: "text/html", host: "meta-radar.example" },
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Meta Radar analyst surface", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Meta Radar · Pro Meta Intelligence<\/title>/i);
  assert.match(html, /변화를 먼저 보고/);
  assert.match(html, /REKSAI/i);
  assert.match(html, /NO COMPOSITE SCORE/);
  assert.match(html, /JSON 불러오기/);
  assert.match(html, /FEED CONNECTING/);
  assert.match(html, /https:\/\/meta-radar\.example\/og\.png/);
  assert.doesNotMatch(html, /codex-preview|Building your site|react-loading-skeleton/i);
});

test("ships a valid same-origin demo feed for automatic loading", async () => {
  const feed = JSON.parse(await readFile(new URL("public/feed/current.json", templateRoot), "utf8"));
  assert.equal(feed.schema_version, "1");
  assert.equal(feed.fixture_only, true);
  assert.ok(feed.entries.length > 0);
});

test("starter preview files are removed", async () => {
  await assert.rejects(access(new URL("../app/_sites-preview", templateRoot)));
});
