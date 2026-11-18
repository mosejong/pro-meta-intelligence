import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { before, after, test } from "node:test";
import ts from "typescript";

let directory, api, report, snapshot;
const id = "a".repeat(22), token = "b".repeat(32), invite = "c".repeat(32), view = "d".repeat(32);
const json = value => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "draft-room-client-test-"));
  const compiled = new Set();
  async function compile(name) {
    if (compiled.has(name)) return;
    compiled.add(name);
    const source = await readFile(new URL(`../app/${name}.ts`, import.meta.url), "utf8");
    let output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
    const deps = [...output.matchAll(/from ["']\.\/([^"']+)["']/g)].map(m => m[1]);
    for (const dep of deps) await compile(dep);
    output = output.replace(/from (["'])\.\/([^"']+)\1/g, 'from "./$2.mjs"');
    await writeFile(path.join(directory, name + ".mjs"), output);
  }
  await compile("draft-room-client");
  api = await import(pathToFileURL(path.join(directory, "draft-room-client.mjs")));
  const agent = await import(pathToFileURL(path.join(directory, "draft-agent.mjs")));
  report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
  snapshot = { id, revision: 0, patch_id: report.patch_id, cutoff: report.cutoff, model_version: agent.DRAFT_MODEL_VERSION,
    blueTeamId: report.opponent_prep.teams[0].team_id, redTeamId: report.opponent_prep.teams[1].team_id,
    firstPickSide: "BLUE", selections: [], games: [], seats: { BLUE: true, RED: false }, status: "WAITING", expiresAt: "2099-01-01T00:00:00Z" };
});
after(async () => {
  if (directory && path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(directory).startsWith("draft-room-client-test-")) await rm(directory, { recursive: true, force: true });
});
const packed = x => "https://example.org/app/#room=" + Buffer.from(JSON.stringify(x)).toString("base64url");
const denied = () => { throw new Error("denied"); };
function stream(chunks) {
  return new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); } }), { headers: { "Content-Type": "application/x-ndjson" } });
}
test("strict room fragment and invite URLs never leak owner, query or endpoint", () => {
  const href = api.createRoomUrl("https://example.org/app/?token=private#draft=old", id, "invite", invite);
  assert.deepEqual(api.parseRoomLink(href), { v: 1, id, invite });
  assert.equal(new URL(href).search, ""); assert.equal(new URL(href).pathname, "/app/");
  assert.ok(!href.includes(token)); assert.ok(!href.includes("localhost"));
  assert.equal(api.parseRoomLink("https://example.org/#draft=abc"), null);
  for (const value of [{ v: 2, id, invite }, { v: 1, id: "short", invite }, { v: 1, id, invite: "short" }, { v: 1, id, invite, view }, { v: 1, id, invite, endpoint: "http://node" }, { v: 1, id, token }]) assert.throws(() => api.parseRoomLink(packed(value)));
  assert.throws(() => api.parseRoomLink(packed({ v: 1, id, invite }) + "&draft=x"));
  assert.throws(() => api.parseRoomLink("https://example.org/#room=%%%"));
});
test("snapshots validate revision, model, teams, patch, turns and public schema", () => {
  const parsed = api.validateRoomSnapshot(snapshot, report);
  assert.equal(parsed.session.report.cutoff, report.cutoff); assert.equal(parsed.session.stagedChampion, null);
  for (const patch of [{ revision: -1 }, { revision: .5 }, { patch_id: "wrong" }, { cutoff: "wrong" }, { model_version: "wrong" }, { blueTeamId: "missing" }, { firstPickSide: "OTHER" }, { token }, { selections: [{ champion_id: "Aatrox" }] }, { status: "DRAFTING" }, { expiresAt: "bad" }]) assert.throws(() => api.validateRoomSnapshot({ ...snapshot, ...patch }, report));
});
test("storage denial keeps usable memory credentials and warns; malformed storage ignored", () => {
  const store = api.createCredentialStore(denied);
  store.set({ id, role: "BLUE", token });
  assert.equal(store.get(id).token, token); assert.equal(store.warning, true);
  const corrupt = api.createCredentialStore(() => ({ getItem: () => '{"token":"oops"}' }));
  assert.equal(corrupt.get(id), null); assert.equal(corrupt.get("bad"), null);
});
test("NDJSON split chunks, keepalive, malformed frames and abort cancellation", async () => {
  const found = []; const abort = new AbortController();
  await api.fetchNDJSON(stream(['\n{"snap', 'shot":{"revision":1}}\r\n\n{"snapshot":', '{"revision":2}}']), abort.signal, x => found.push(x));
  assert.deepEqual(found.map(x => x.snapshot.revision), [1, 2]);
  await assert.rejects(api.fetchNDJSON(stream(['{"broken"\n']), abort.signal, () => {}));
  await assert.rejects(api.fetchNDJSON(stream(['x'.repeat(262145)]), abort.signal, () => {}));
  let cancelled = false;
  const pending = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "Content-Type": "application/x-ndjson" } });
  const promise = api.fetchNDJSON(pending, abort.signal, () => assert.fail("aborted frame"));
  abort.abort(); await promise; assert.equal(cancelled, true);
});
test("create uses share fragment, authenticates streams, monotonic snapshots and aborts leave", async () => {
  const calls = [], seen = [], states = []; let events;
  const request = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/events")) return new Response(new ReadableStream({ start(c) { events = c; }, cancel() {} }), { headers: { "Content-Type": "application/x-ndjson" } });
    if (url.endsWith("/v1/rooms")) return json({ id, role: "BLUE", token, invite, view, snapshot });
    if (url.endsWith("/actions")) return json({ snapshot: { ...snapshot, revision: 3 } });
    return json({ id, role: "BLUE", snapshot });
  };
  const client = new api.DraftRoomClient("https://rooms.example", () => report, s => states.push(s), (s, reset) => seen.push({ s, reset }), api.createCredentialStore(denied), request);
  await client.enter({ share: "#draft=abc" }); await tick();
  assert.deepEqual(JSON.parse(calls[0].init.body), { share: "#draft=abc" });
  const send = value => events.enqueue(new TextEncoder().encode(JSON.stringify({ snapshot: value }) + "\n"));
  send(snapshot); send({ ...snapshot, revision: 2 }); send({ ...snapshot, revision: 1 }); await tick();
  assert.equal(states.at(-1).connected, true); assert.equal(states.at(-1).snapshot.revision, 2);
  assert.equal(seen.length, 2); assert.equal(seen[0].reset, true); assert.equal(seen[1].reset, false);
  for (const call of calls.slice(1)) { assert.equal(call.init.headers.Authorization, "Bearer " + token); assert.ok(!call.url.includes(token)); }
  send({ ...snapshot, id: "z".repeat(22), revision: 8 }); await tick();
  assert.equal(states.at(-1).snapshot.id, id); assert.equal(states.at(-1).connected, false);
  const signal = calls[1].init.signal; client.leave(); assert.equal(signal.aborted, true); assert.equal(states.at(-1).active, false);
});
test("stale enter response cannot overwrite new mode; invalid init and errors stay locked", async () => {
  let resolve;
  const applied = [], states = [];
  const client = new api.DraftRoomClient("https://rooms.example", () => report, s => states.push(s), s => applied.push(s), api.createCredentialStore(denied), () => new Promise(r => { resolve = r; }));
  const entering = client.enter({ share: "#draft=x" }); client.leave();
  resolve(json({ id, role: "BLUE", token, invite, view, snapshot })); await entering;
  assert.equal(applied.length, 0); assert.equal(states.at(-1).active, false);
  for (const result of [json({ id, role: "BLUE", token: "bad", snapshot }), new Response('{"error":{"code":"SEAT_TAKEN"}}', { status: 409 })]) {
    const c = new api.DraftRoomClient("https://rooms.example", () => report, s => states.push(s), () => assert.fail("bad response"), api.createCredentialStore(denied), async () => result);
    await c.enter({ v: 1, id, invite }); assert.equal(states.at(-1).connected, false); assert.equal(states.at(-1).sending, false); c.leave();
  }
});
test("existing credential resumes with GET, never consumes invite or rejoins seat", async () => {
  const calls = [], store = api.createCredentialStore(denied); store.set({ id, role: "RED", token });
  const client = new api.DraftRoomClient("https://rooms.example", () => report, () => {}, () => {}, store, async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("events")) return new Response(new ReadableStream({}), { headers: { "Content-Type": "application/x-ndjson" } });
    return json({ id, role: "RED", snapshot });
  });
  await client.enter({ v: 1, id, invite }); await tick(); client.leave();
  assert.equal(calls[0].init.method, "GET"); assert.equal(calls[0].init.headers.Authorization, "Bearer " + token);
  assert.ok(calls.every(c => !c.url.endsWith("join")));
});

test("reconnect waits, refreshes latest snapshot, and retains Authorization credentials", async () => {
  let streams = 0;
  const calls = [], states = [], applied = [];
  const current = { ...snapshot, status: "DRAFTING", seats: { BLUE: true, RED: true } };
  const store = api.createCredentialStore(denied); store.set({ id, role: "BLUE", token });
  const client = new api.DraftRoomClient("https://rooms.example", () => report, s => states.push(s), (s, reset) => applied.push(reset), store, async (url, init) => {
    calls.push({ url, init, time: Date.now() });
    if (url.endsWith("/events")) {
      streams++;
      if (streams === 1) return stream([JSON.stringify({ snapshot: current }) + "\n"]);
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(JSON.stringify({ snapshot: { ...current, revision: 4 } }) + "\n")); } }), { headers: { "Content-Type": "application/x-ndjson" } });
    }
    return json({ id, role: "BLUE", snapshot: { ...current, revision: streams ? 4 : 0 } });
  });
  try {
    await client.enter({ v: 1, id });
    const deadline = Date.now() + 3000;
    while ((streams < 2 || !states.at(-1).connected) && Date.now() < deadline) await tick();
    assert.equal(streams, 2); assert.equal(states.at(-1).connected, true); assert.equal(states.at(-1).snapshot.revision, 4);
    assert.ok(states.some(s => s.active && !s.connected && s.message?.includes("연결을 다시")));
    const events = calls.filter(c => c.url.endsWith("events"));
    assert.ok(events[1].time - events[0].time >= 450);
    assert.equal(calls[calls.indexOf(events[1]) - 1].url, "https://rooms.example/v1/rooms/" + id);
    assert.ok(calls.every(c => c.init.headers.Authorization === "Bearer " + token));
    assert.deepEqual(applied, [true, false]);
  } finally { client.leave(); }
});

test("remote SELECT waits for authoritative response and locks duplicate sending", async () => {
  const current = { ...snapshot, status: "DRAFTING", seats: { BLUE: true, RED: true } };
  let finish; const calls = [], states = [], applied = [];
  const store = api.createCredentialStore(denied); store.set({ id, role: "BLUE", token });
  const client = new api.DraftRoomClient("https://rooms.example", () => report, s => states.push(s), s => applied.push(s), store, async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("actions")) return new Promise(resolve => { finish = resolve; });
    if (url.endsWith("events")) return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(JSON.stringify({ snapshot: current }) + "\n")); } }), { headers: { "Content-Type": "application/x-ndjson" } });
    return json({ id, role: "BLUE", snapshot: current });
  });
  try {
    await client.enter({ v: 1, id }); await tick();
    const action = client.action("SELECT", "Aatrox");
    assert.equal(states.at(-1).sending, true); assert.equal(applied.length, 1);
    await client.action("SELECT", "Ahri");
    assert.equal(calls.filter(c => c.url.endsWith("actions")).length, 1);
    const payload = JSON.parse(calls.at(-1).init.body);
    assert.match(payload.id, /^[0-9a-f-]{36}$/); assert.equal(payload.revision, 0); assert.equal(payload.championId, "Aatrox");
    const agent = await import(pathToFileURL(path.join(directory, "draft-agent.mjs")));
    const updated = { ...current, revision: 1, selections: agent.applyDraftSelection([], "Aatrox", [], "BLUE") };
    finish(json({ id, role: "BLUE", snapshot: updated })); await action;
    assert.equal(applied.length, 2); assert.equal(states.at(-1).sending, false);
    await client.action("SELECT", "Ahri"); // RED turn; no outgoing action.
    assert.equal(calls.filter(c => c.url.endsWith("actions")).length, 1);
  } finally { client.leave(); }
});

test("401/404/410 after initialization stop reconnecting; ROOM_EXPIRED stream stops too", async () => {
  await Promise.all([401, 404, 410, "stream"].map(async status => {
    let reads = 0, events = 0; const states = [];
    const store = api.createCredentialStore(denied); store.set({ id, role: "BLUE", token });
    const client = new api.DraftRoomClient("https://rooms.example", () => report, s => states.push(s), () => {}, store, async url => {
      if (url.endsWith("events")) { events++; return stream([JSON.stringify({ snapshot }) + "\n", JSON.stringify({ error: { code: "ROOM_EXPIRED", message: "expired" } }) + "\n"]); }
      reads++;
      if (reads > 1 && status !== "stream") return new Response("{}", { status });
      return json({ id, role: "BLUE", snapshot });
    });
    try {
      await client.enter({ v: 1, id });
      await new Promise(resolve => setTimeout(resolve, 650));
      assert.equal(reads, 2); assert.equal(events, status === "stream" ? 1 : 0);
      assert.equal(states.at(-1).connected, false); assert.equal(states.at(-1).sending, false);
      assert.ok(states.at(-1).message.includes(status === 401 ? "참여 정보" : "만료"));
    } finally { client.leave(); }
  }));
});

test("cached BLUE resume recovers private invite keys outside the public snapshot", async () => {
  const store = api.createCredentialStore(denied); store.set({ id, role: "BLUE", token });
  const states = [], calls = [];
  const client = new api.DraftRoomClient("https://rooms.example", () => report, s => states.push(s), session => assert.ok(!JSON.stringify(session).includes(token)), store, async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("events")) return new Response(new ReadableStream({}), { headers: { "Content-Type": "application/x-ndjson" } });
    return json({ id, role: "BLUE", snapshot, invite, view });
  });
  try {
    await client.enter({ v: 1, id });
    assert.equal(states.at(-1).invite, invite); assert.equal(states.at(-1).view, view);
    assert.equal(store.get(id).token, token); assert.equal(calls[0].init.method, "GET");
    assert.ok(!JSON.stringify(states.at(-1).snapshot).includes(invite));
    assert.ok(!JSON.stringify(states.at(-1).snapshot).includes(token));
  } finally { client.leave(); }
});
