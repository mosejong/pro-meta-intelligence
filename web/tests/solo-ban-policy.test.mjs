import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { before, after, test } from "node:test";
import { createServer } from "vite";

// Adopted ban policy (docs/benchmarks/DRAFT_BAN_POLICY_CANDIDATES_2026-11-23.md): same-patch presence.
let vite, solo, text, ids, report, base;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  solo = await vite.ssrLoadModule("/app/solo-draft.ts");
  text = await vite.ssrLoadModule("/app/solo-draft-history-text.ts");
  const { SHARE_CHAMPIONS } = await vite.ssrLoadModule("/app/share-champion-ids.ts");
  ids = SHARE_CHAMPIONS.map(([, id]) => id);
  report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
  delete report.patch_presence;
  base = { report, blueTeam: report.opponent_prep.teams[0], redTeam: report.opponent_prep.teams[1],
    selections: [], previousPicks: [], firstPickSide: "BLUE", manualSide: "RED" };
});
after(async () => { await vite?.close(); });

const withPresence = (champions, matchCount = 20) => ({ ...base, report: { ...report,
  patch_presence: { patch_id: report.patch_id, cutoff: report.cutoff, match_count: matchCount, champions } } });

test("the default ban policy is same-patch presence", () => {
  assert.equal(solo.DEFAULT_BAN_POLICY, "PATCH_PRESENCE");
});

test("bans follow same-patch pick+ban presence and are explained as such", () => {
  const rows = [
    { champion_id: ids[5], picks: 2, bans: 3 },
    { champion_id: ids[9], picks: 10, bans: 6 },
    { champion_id: ids[7], picks: 1, bans: 9 },
  ];
  const input = withPresence(rows);
  const explanation = solo.explainSoloDraftTurn(input);
  assert.equal(explanation.kind, "BAN");
  assert.deepEqual([explanation.selected, ...explanation.alternatives].map(c => c.champion_id), [ids[9], ids[7], ids[5]]);
  assert.equal(explanation.selected.source, "PATCH_PRESENCE");
  assert.equal(explanation.selected.evidence, "PATCH_PRESENCE");
  assert.equal(solo.suggestSoloDraftTurn(input).champion_id, ids[9]);
  // An already-taken champion is skipped.
  let selections = [];
  const agentApply = (id) => { selections = [...selections, { turn: 1, side: "BLUE", kind: "BAN", slot: 1, phase: 1, champion_id: id }]; };
  agentApply(ids[9]);
  const next = solo.explainSoloDraftTurn({ ...input, selections, manualSide: "BLUE" });
  assert.equal(next.selected.champion_id, ids[7]);
});

test("without presence data or with the old policy, bans use the opposing team record as before", () => {
  const old = solo.explainSoloDraftTurn(base);
  assert.equal(old.selected.source, "TEAM_RECORD");
  const explicit = solo.explainSoloDraftTurn({ ...withPresence([{ champion_id: ids[9], picks: 5, bans: 5 }]), banPolicy: "OPPONENT_RECORD" });
  assert.deepEqual(explicit, old);
  assert.equal(solo.explainSoloDraftTurn(withPresence([{ champion_id: ids[9], picks: 5, bans: 5 }], 0)).selected.source, "TEAM_RECORD");
});

test("picks are unchanged by the ban policy", () => {
  let selections = [];
  const order = ids.slice(40, 46);
  for (const [i, id] of order.entries()) selections.push({ turn: i + 1, side: i % 2 ? "RED" : "BLUE", kind: "BAN", slot: Math.floor(i / 2) + 1, phase: 1, champion_id: id });
  const input = { ...base, selections, manualSide: "RED" };
  const presence = withPresence([{ champion_id: ids[9], picks: 30, bans: 30 }]);
  // Isolate the ban policy: with the pick policy held fixed, a ban-only presence change never alters picks.
  assert.deepEqual(solo.explainSoloDraftTurn({ ...presence, selections, manualSide: "RED", pickPolicy: "TEAM_AND_META" }), solo.explainSoloDraftTurn(input));
});

test("the readable review accepts the presence evidence", () => {
  const explanation = solo.explainSoloDraftTurn(withPresence([{ champion_id: ids[9], picks: 4, bans: 4 }]));
  const record = { turn: 1, champion_id: explanation.selected.champion_id, reason: explanation.selected.reason, prefix: [], context: "ctx", explanation };
  const result = text.buildSoloHistoryText({ history: [record], patchId: "26.22", cutoff: "2026-11-17T00:00:00Z", nameOf: (id) => `챔-${id}` });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.text.includes("같은 패치의 공개 픽·밴 빈도"));
});

test("pick candidates rank team rate plus same-patch share among role-feasible champions", () => {
  const selections = [];
  const order = ids.slice(40, 46);
  for (const [i, id] of order.entries()) selections.push({ turn: i + 1, side: i % 2 ? "RED" : "BLUE", kind: "BAN", slot: Math.floor(i / 2) + 1, phase: 1, champion_id: id });
  const presence = withPresence([
    { champion_id: ids[11], picks: 18, bans: 0, roles: [{ role: "MID", picks: 18 }] },
    { champion_id: ids[12], picks: 2, bans: 16, roles: [{ role: "TOP", picks: 2 }] },
    { champion_id: ids[13], picks: 19, bans: 0, roles: [] },
  ]);
  const state = { ...presence, selections, manualSide: "RED" };
  assert.equal(solo.DEFAULT_PICK_POLICY, "TEAM_PLUS_PATCH_PRESENCE");
  assert.deepEqual(solo.explainSoloDraftTurn(state), solo.explainSoloDraftTurn({ ...state, pickPolicy: "TEAM_PLUS_PATCH_PRESENCE" }));
  // Without presence data picks stay on the previous team-and-meta rules.
  assert.deepEqual(solo.explainSoloDraftTurn({ ...base, selections, manualSide: "RED" }), solo.explainSoloDraftTurn({ ...base, selections, manualSide: "RED", pickPolicy: "TEAM_AND_META" }));
  const picks = solo.explainSoloDraftTurn({ ...state, pickPolicy: "TEAM_PLUS_PATCH_PICKS" });
  const presenceFirst = solo.explainSoloDraftTurn({ ...state, pickPolicy: "TEAM_PLUS_PATCH_PRESENCE" });
  assert.equal(picks.kind, "PICK");
  const chosen = [picks.selected, ...picks.alternatives].map(c => c.champion_id);
  assert.ok(!chosen.includes(ids[13]), "a champion without any role evidence is never role-feasible");
  assert.ok(chosen.includes(ids[11]) || picks.selected.source !== "PATCH_PRESENCE");
  for (const e of [picks, presenceFirst]) for (const c of [e.selected, ...e.alternatives]) {
    if (c.source === "PATCH_PRESENCE") { assert.equal(c.evidence, "PATCH_PRESENCE"); assert.equal(c.role_supported, true); }
  }
});
