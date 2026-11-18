import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

let vite, soloRoleCandidates, canCoverRoles, playerKey;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  ({ soloRoleCandidates, canCoverRoles } = await vite.ssrLoadModule("/app/solo-role-candidates.ts"));
  ({ playerKey } = await vite.ssrLoadModule("/app/roster-scenario.ts"));
});
after(async () => { await vite?.close(); });

const report = { cutoff: "2026-11-01T00:00:00Z", patch_id: "16.21" };
const row = (champion_id, role, game_rate = 0.4, game_count = 4) => ({ champion_id, role, game_rate, game_count });
const profile = (player_id, role, champions = [], roster_status = "CURRENT") => ({ player_id, role, champions, roster_status });
const team = (player_profiles = [], priority_picks = []) => ({ team_id: "t", player_profiles, priority_picks });
const record = (player_id = "p", team_id = "t", roles = ["TOP"]) => ({ team_id, player_id, status: "FOUND",
  roles: Object.fromEntries(roles.map(role => [role, { season: { games: 10, champions: [
    { champion_id: "Aatrox", games: 7 }, { champion_id: "Ahri", games: 3 }] } }])) });
const history = (records = [record()]) => ({ season: 2026, cutoff: report.cutoff, reference_patch: report.patch_id,
  source: { retrieved_at: "2026-10-31T00:00:00Z" }, players: new Map(records.map(p => [playerKey(p.team_id, p.player_id), p])) });

test("season ratio, role union, max scores, aliases and deterministic tie order", () => {
  const t = team([profile("p", "TOP", [row("Aatrox", undefined, 0.2)])], [
    row("Aatrox", "MID", 0.5), row("Aatrox", "MID", 0.5), row("Kai'Sa", "ADC", 0.3), row("Kaisa", "BOTTOM", 0.6)]);
  assert.deepEqual(soloRoleCandidates(t, report, history()), [
    { champion_id: "Aatrox", roles: ["TOP", "MID"], score: 0.7, season: true },
    { champion_id: "Kaisa", roles: ["BOTTOM"], score: 0.6, season: false },
    { champion_id: "Ahri", roles: ["TOP"], score: 0.3, season: true }]);
  assert.deepEqual(soloRoleCandidates(team([], [row("Zed", "MID"), row("Ahri", "MID")]), report).map(c => c.champion_id), ["Ahri", "Zed"]);
});

test("only CURRENT profiles; distinct players make a season role ambiguous", () => {
  for (const status of ["OTHER_OBSERVED", undefined]) {
    const p = profile("p", "TOP", [row("Zed", "TOP")]);
    p.roster_status = status;
    assert.deepEqual(soloRoleCandidates(team([p]), report, history()), []);
  }
  const p = profile("p", "TOP", [row("Zed", "TOP")]);
  assert.ok(soloRoleCandidates(team([p, structuredClone(p)]), report, history()).some(c => c.season));
  const ambiguous = soloRoleCandidates(team([p, profile("q", "TOP")]), report, history([record(), record("q")]));
  assert.deepEqual(ambiguous, [{ champion_id: "Zed", roles: ["TOP"], score: 0.4, season: false }]);
  assert.deepEqual(soloRoleCandidates(team([profile("p", "OTHER", [row("Zed", "TOP")])]), report, history()), []);
});

test("history joins exact team/player IDs, including record identity", () => {
  const t = team([profile("p", "TOP")]);
  for (const records of [[record("P")], [record("p", "other")]]) {
    assert.deepEqual(soloRoleCandidates(t, report, history(records)), []);
  }
  const h = history();
  h.players.set(playerKey("t", "p"), record("p", "wrong"));
  assert.deepEqual(soloRoleCandidates(t, report, h), []);
  h.players.set(playerKey("t", "p"), { ...record(), status: "NOT_FOUND" });
  assert.deepEqual(soloRoleCandidates(t, report, h), []);
});

test("stale cutoff, patch/year mismatch, invalid and future sources reject season only", () => {
  const t = team([profile("p", "TOP")], [row("Zed", "MID")]);
  const baseline = soloRoleCandidates(t, report);
  const changes = [{ cutoff: "2026-10-31T00:00:00Z" }, { reference_patch: "16.20" }, { season: 2025 },
    { source: { retrieved_at: "2026-11-02T00:00:00Z" } }, { source: { retrieved_at: "invalid" } }];
  for (const change of changes) assert.deepEqual(soloRoleCandidates(t, report, { ...history(), ...change }), baseline);
  assert.deepEqual(soloRoleCandidates(t, report, null), baseline);
  assert.ok(soloRoleCandidates(t, report, { ...history(), source: { retrieved_at: report.cutoff } }).some(c => c.season));
});

test("rejects nonpositive/nonfinite rows and unknown champions; retains priority scores without role hints", () => {
  const bad = [0, -1, NaN, Infinity];
  const rows = bad.flatMap(n => [row("Ahri", "MID", n), row("Ahri", "MID", 0.4, n)]);
  rows.push(row("FakeChampion", "TOP"), row("Zed", "OTHER"));
  const h = history();
  h.players.get(playerKey("t", "p")).roles.TOP.season.champions = [
    ...bad.map(games => ({ champion_id: "Ahri", games })), { champion_id: "FakeChampion", games: 10 }];
  assert.deepEqual(soloRoleCandidates(team([profile("p", "TOP")], rows), report, h), [
    { champion_id: "Zed", roles: [], score: 0.4, season: false }]);
  h.players.get(playerKey("t", "p")).roles.TOP.season.games = Infinity;
  assert.deepEqual(soloRoleCandidates(team([profile("p", "TOP")]), report, h), []);
});

const candidate = (champion_id, roles) => ({ champion_id, roles, score: 1, season: false });
test("bipartite matching reassigns flex picks; impossible triple TOP and unknown roles fail", () => {
  const candidates = [candidate("Ahri", ["TOP", "MID"]), candidate("Aatrox", ["TOP"]),
    candidate("Zed", ["TOP"]), candidate("Kaisa", ["BOTTOM"]), candidate("Lux", ["SUPPORT"]), candidate("Vi", ["JUNGLE"])];
  assert.equal(canCoverRoles(["Ahri"], candidates, "Aatrox"), true);
  assert.equal(canCoverRoles(["Ahri", "Aatrox"], candidates, "Zed"), false);
  assert.equal(canCoverRoles(["Ahri", "Aatrox", "Kai'Sa", "Lux"], candidates, "Vi"), true);
  assert.equal(canCoverRoles(["Ahri", "Aatrox", "Kaisa", "Lux", "Vi"], candidates, "Zed"), false);
  assert.equal(canCoverRoles(["Unknown"], candidates), false);
  assert.equal(canCoverRoles(["Zed"], [candidate("Zed", ["OTHER"])]), false);
  assert.equal(canCoverRoles(["Zed"], [candidate("Zed", [])]), false);
  assert.equal(canCoverRoles([], candidates), true);
});

test("inputs remain unchanged and evidence/pick/candidate reordering preserves results", () => {
  const t = team([profile("p", "TOP", [row("Ahri", "TOP"), row("Aatrox", "TOP")]), profile("b", "ADC")],
    [row("Aatrox", "MID"), row("Ahri", "MID")]);
  const h = history([record(), record("b", "t", ["BOTTOM"])]);
  const original = structuredClone({ t, h, report });
  const result = soloRoleCandidates(t, report, h);
  assert.deepEqual({ t, h, report }, original);
  t.priority_picks.reverse();
  t.player_profiles.reverse();
  for (const p of t.player_profiles) p.champions.reverse();
  h.players = new Map([...h.players].reverse());
  for (const p of h.players.values()) for (const r of Object.values(p.roles)) r.season.champions.reverse();
  assert.deepEqual(soloRoleCandidates(t, report, h), result);
  const picks = ["Ahri", "Aatrox"];
  const before = structuredClone({ picks, result });
  assert.equal(canCoverRoles(picks, result), canCoverRoles([...picks].reverse(), [...result].reverse()));
  assert.deepEqual({ picks, result }, before);
});
