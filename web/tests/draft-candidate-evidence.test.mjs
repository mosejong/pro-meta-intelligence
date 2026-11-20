import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

let vite, evidence;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  ({ draftCandidateEvidence: evidence } = await vite.ssrLoadModule("/app/draft-candidate-evidence.ts"));
});
after(async () => vite?.close());
const report = { cutoff: "2026-11-18T00:00:00Z", patch_id: "16.20", entries: [{ champion_id: "Velkoz", role: "MID", eligible_for_review: true }] };
const team = { team_id: "t", priority_picks: [], player_profiles: [] };

test("eligible meta can be proposed without player experience; aliases stay identical", () => {
  const result = evidence(report, team, "Vel'Koz");
  assert.equal(result.category, "META"); assert.equal(result.teamObserved, false); assert.equal(result.seasonObserved, false);
  assert.deepEqual(result.roles, ["MID"]);
  assert.deepEqual(result, evidence(report, team, "Velkoz"));
});
test("off-meta team records remain selectable and unobserved lists stay unknown", () => {
  const t = { ...team, priority_picks: [{ champion_id: "Ahri", role: "MID", game_count: 3, game_rate: 0.5 }] };
  const result = evidence(report, t, "Ahri"); assert.equal(result.category, "OFF_META"); assert.equal(result.teamObserved, true);
  assert.match(result.boundary, /검증되지/);
  const unknown = evidence(report, t, "Zed"); assert.equal(unknown.category, "EXPLORATORY"); assert.equal(unknown.teamObserved, false);
});
test("ineligible meta is not promoted, and other observed players are not current evidence", () => {
  const r = { ...report, entries: report.entries.map(e => ({ ...e, eligible_for_review: false })) };
  const t = { ...team, player_profiles: [{ player_id: "p", role: "MID", roster_status: "OTHER_OBSERVED", champions: [{ champion_id: "Velkoz", game_rate: 0.8, game_count: 4 }] }] };
  assert.equal(evidence(r, t, "Velkoz").category, "EXPLORATORY");
});
test("season evidence is joined by exact IDs and stale history cannot relabel a candidate", () => {
  const t = { ...team, player_profiles: [{ player_id: "p", role: "MID", roster_status: "CURRENT", champions: [] }] };
  const h = { season: 2026, cutoff: report.cutoff, reference_patch: report.patch_id, source: { retrieved_at: report.cutoff }, players: new Map([[JSON.stringify(["t", "p"]), { team_id: "t", player_id: "p", status: "FOUND", roles: { MID: { season: { games: 3, champions: [{ champion_id: "Ahri", games: 3 }] } } } }]]) };
  assert.equal(evidence(report, t, "Ahri", h).seasonObserved, true);
  assert.equal(evidence(report, t, "Ahri", { ...h, cutoff: "2026-11-17T00:00:00Z" }).category, "EXPLORATORY");
  assert.equal(evidence(report, { ...t, team_id: "another" }, "Ahri", h).seasonObserved, false);
});
