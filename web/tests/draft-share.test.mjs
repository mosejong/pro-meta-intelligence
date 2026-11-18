import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { before, after, test } from "node:test";
import { createServer } from "vite";

let vite, share, agent, report, ids, base;
const encode = data => `https://example.org/nested/app/#draft=${Buffer.from(JSON.stringify(data)).toString("base64url")}`;
const decode = url => JSON.parse(Buffer.from(new URL(url).hash.slice(7), "base64url"));
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false,
    server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  share = await vite.ssrLoadModule("/app/draft-share.ts");
  agent = await vite.ssrLoadModule("/app/draft-agent.ts");
  report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
  const fixture = JSON.parse(await readFile(new URL("./fixtures/champion-asset-ids-16.16.1.json", import.meta.url), "utf8"));
  ids = fixture.champions.map(c => c.id);
  const production = await vite.ssrLoadModule("/app/share-champion-ids.ts");
  assert.deepEqual(production.SHARE_CHAMPIONS, fixture.champions.map(c => [c.name, c.id]));
  const [blue, red] = report.opponent_prep.teams;
  base = { report, blueTeamId: blue.team_id, redTeamId: red.team_id, selections: [], games: [], stagedChampion: null, firstPickSide: "BLUE" };
});
after(async () => { await vite?.close(); });
function selections(first = "BLUE", count = 20, locks = []) {
  let result = [];
  for (const id of ids.filter(id => !locks.includes(id)).slice(0, count)) result = agent.applyDraftSelection(result, id, locks, first);
  assert.equal(result.length, count);
  return result;
}
test("empty, blue and red first draft links preserve base path and use current evidence", () => {
  for (const firstPickSide of ["BLUE", "RED"]) for (const count of [0, 8, 20]) {
    const session = { ...base, firstPickSide, selections: selections(firstPickSide, count) };
    const url = share.createDraftShareUrl("https://example.org/nested/app/?private=secret#old", session);
    assert.equal(new URL(url).pathname, "/nested/app/");
    assert.equal(new URL(url).search, "");
    assert.equal(new URL(url).origin, "https://example.org");
    const latest = { ...report, cutoff: "new public cutoff" };
    const restored = share.parseDraftShareUrl(url, latest);
    assert.deepEqual(restored.report, latest);
    assert.deepEqual(restored.selections, session.selections);
    assert.equal(restored.firstPickSide, firstPickSide);
  }
  for (const origin of ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"]) assert.ok(share.createDraftShareUrl(origin + "/app", base).startsWith(origin));
  for (const origin of ["http://example.org", "file:///tmp/app", "javascript:alert(1)"]) assert.throws(() => share.createDraftShareUrl(origin, base));
});
test("previous sets replay hard fearless, swapped sides, stage and red first", () => {
  const game = { blue_team_id: base.redTeamId, red_team_id: base.blueTeamId, selections: selections("RED") };
  const locks = agent.fearlessLocks([game]);
  const current = selections("RED", 4, locks);
  const stage = ids.find(id => !locks.includes(id) && !current.some(s => s.champion_id === id));
  const url = share.createDraftShareUrl("https://example.org/", { ...base, games: [game], firstPickSide: "RED", selections: current, stagedChampion: stage });
  const restored = share.parseDraftShareUrl(url, report);
  assert.deepEqual(restored.games, [game]);
  assert.deepEqual(restored.selections, current);
  assert.equal(restored.stagedChampion, stage);
  const data = decode(url);
  data.turns[0][5] = locks[0];
  assert.throws(() => share.parseDraftShareUrl(encode(data), report));
  data.turns = []; data.stage = locks[0];
  assert.throws(() => share.parseDraftShareUrl(encode(data), report));
});
test("tampered order, duplicates, teams, champions, patch and markers are rejected", () => {
  const original = decode(share.createDraftShareUrl("https://example.org/", { ...base, selections: selections("BLUE", 3) }));
  for (const mutate of [
    d => d.turns[1][5] = d.turns[0][5], d => d.turns.reverse(), d => d.turns[0][0] = 3,
    d => d.turns[0][1] = "RED", d => d.turns[0][4] = 2, d => d.turns[0][5] = "FakeChampion",
    d => d.stage = "FakeChampion", d => d.blue = "unknown", d => d.red = d.blue,
    d => d.patch = "other", d => d.version = 2, d => d.model = "other", d => d.first = "PURPLE",
    d => d.games = Array(10).fill({}), d => d.games = [{ blue: d.blue, red: d.red, first: "BLUE", turns: d.turns }],
  ]) {
    const data = structuredClone(original); mutate(data);
    assert.throws(() => share.parseDraftShareUrl(encode(data), report));
  }
});
test("canonical official names and aliases resolve; no report, roster, private or evidence leak", () => {
  for (const id of ["Wukong", "Cho'Gath", "Vel'Koz", "LeBlanc", "Nunu & Willump", "Aurelion Sol"]) {
    const url = share.createDraftShareUrl("https://example.org/", { ...base, stagedChampion: id, roster: "PRIVATE", roles: "SECRET" });
    const data = decode(url);
    assert.ok(ids.includes(data.stage));
    assert.doesNotMatch(JSON.stringify(data), /analysis_snapshot|evidence|roster|roles|PRIVATE|SECRET|cutoff|team_name/);
    assert.ok(share.parseDraftShareUrl(url, report));
  }
});
test("malformed base64, UTF8, JSON and both size limits are rejected", () => {
  for (const raw of ["", "a", "====", "%20", "a+b", "a/b", "_w", Buffer.from("not json").toString("base64url"), Buffer.alloc(8001, 32).toString("base64url"), "a".repeat(12001)]) {
    assert.throws(() => share.parseDraftShareUrl(`https://example.org/#draft=${raw}`, report));
  }
  assert.throws(() => share.createDraftShareUrl("https://example.org/" + "x".repeat(12000), base));
  assert.throws(() => share.createDraftShareUrl("https://example.org/", { ...base, games: Array(10).fill({ selections: [], blue_team_id: base.blueTeamId, red_team_id: base.redTeamId }) }));
});
