import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

let vite, M;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  M = await vite.ssrLoadModule("/app/simulation-core.ts");
});
after(async () => { await vite?.close(); });
const team = (id, n = 0) => ({ id, assumptions: { lane: n, tempo: n, teamfight: n } });
const input = (seed = 1) => ({ ruleset: M.SIMULATION_RULESET, seed, teams: [team("alpha"), team("beta")] });

test("the same input and seed repeat exactly and cannot retain caller references", () => {
  const original = input();
  const serialized = JSON.stringify(original);
  const first = M.simulateManager(original);
  assert.deepEqual(M.simulateManager(original), first);
  assert.equal(JSON.stringify(original), serialized);
  original.teams[0].assumptions.lane = 1;
  assert.equal(first.input.teams[0].assumptions.lane, 0);
  assert.match(first.boundary, /Not learned/);
});

test("500 seeds terminate, conserve event totals and remain symmetric under side exchange", () => {
  const winners = new Set();
  for (let seed = 0; seed < 500; seed++) {
    const value = input(seed);
    const result = M.simulateManager(value);
    const reverse = M.simulateManager({ ...value, teams: [...value.teams].reverse() });
    assert.deepEqual(result.states, reverse.states);
    assert.deepEqual(result.events, reverse.events);
    assert.equal(result.winner, reverse.winner);
    winners.add(result.winner);
    assert.ok(result.minute >= 18 && result.minute <= 45);
    assert.equal(result.events.at(-1).kind, "END");
    assert.equal(result.events.filter(e => e.kind === "END").length, 1);
    for (const id of ["alpha", "beta"]) {
      const state = result.states[id];
      const own = result.events.filter(e => e.actor === id);
      const damage = result.events.filter(e => e.actor !== id && e.kind === "BASE").reduce((n, e) => n + e.amount, 0);
      const kills = own.filter(e => e.kind === "SKIRMISH").reduce((n, e) => n + e.amount, 0);
      const objectives = own.filter(e => e.kind === "OBJECTIVE").length;
      const growth = own.filter(e => e.kind === "GROWTH").reduce((n, e) => n + e.amount, 0);
      assert.equal(state.gold, 2500 + growth + 300 * kills + 600 * objectives);
      assert.equal(state.kills, kills);
      assert.equal(state.objectives, objectives);
      assert.equal(state.base, 100 - damage);
      assert.ok(state.base >= 0 && state.base <= 100);
      for (const number of Object.values(state)) assert.ok(Number.isSafeInteger(number) && number >= 0);
    }
    for (let i = 1; i < result.events.length; i++) assert.ok(result.events[i].minute >= result.events[i - 1].minute);
    if (result.reason === "BASE_DESTROYED") assert.equal(result.states[result.winner === "alpha" ? "beta" : "alpha"].base, 0);
  }
  assert.equal(winners.size, 2);
});

test("assumption sensitivity is a model property, not an accuracy claim", () => {
  let strongWins = 0;
  for (let seed = 0; seed < 200; seed++) {
    const result = M.simulateManager({ ...input(seed), teams: [team("alpha", 1), team("beta", -1)] });
    if (result.winner === "alpha") strongWins++;
  }
  assert.ok(strongWins >= 180);
});

test("unsupported inputs fail before running a simulation", () => {
  const valid = input();
  const bad = [null, {}, { ...valid, seed: -1 }, { ...valid, seed: 2 ** 32 }, { ...valid, seed: NaN },
    { ...valid, ruleset: "future" }, { ...valid, teams: [] }, { ...valid, teams: Array(2) },
    { ...valid, teams: [team("same"), team("same")] }, { ...valid, hidden_effect: 1 },
    { ...valid, teams: [team("alpha", 1.01), team("beta")] },
    { ...valid, teams: [team("alpha", NaN), team("beta")] },
    { ...valid, teams: [{ ...team("alpha"), champion_bonus: 2 }, team("beta")] }];
  for (const value of bad) {
    assert.equal(M.isManagerInput(value), false);
    assert.throws(() => M.simulateManager(value), /Unsupported/);
  }
});

test("saved runs replay from inputs and reject changes to outcomes, traces or model versions", () => {
  const text = M.serializeManagerRun(input(42));
  const original = JSON.parse(text);
  assert.ok(Buffer.byteLength(text) < M.MAX_SIMULATION_FILE_BYTES);
  assert.equal(M.replayManagerFile(text).ok, true);
  const changes = [v => { v.result.winner = "invented"; }, v => { v.result.events[0].amount++; },
    v => { v.result.input.ruleset = "next"; }, v => { v.schema_version = 2; },
    v => { v.result.input.teams[0].assumptions.lane = 100; }];
  for (const change of changes) {
    const value = structuredClone(original);
    change(value);
    assert.equal(M.replayManagerFile(JSON.stringify(value)).ok, false);
  }
  assert.equal(M.replayManagerFile("x").ok, false);
  assert.equal(M.replayManagerFile(" ".repeat(M.MAX_SIMULATION_FILE_BYTES + 1)).ok, false);
});
