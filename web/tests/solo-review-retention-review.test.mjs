import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createServer } from "vite";

test("independent real automatic turn binds saved note to board, side and exact supplied hash", async () => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const codec = await vite.ssrLoadModule("/app/solo-review-retention.ts");
    const agent = await vite.ssrLoadModule("/app/draft-agent.ts");
    const solo = await vite.ssrLoadModule("/app/solo-draft.ts");
    const ui = await vite.ssrLoadModule("/app/solo-draft-explanation.tsx");
    const history = await vite.ssrLoadModule("/app/solo-draft-history.ts");
    const roster = await vite.ssrLoadModule("/app/roster-scenario.ts");
    const sessions = await vite.ssrLoadModule("/app/draft-session.ts");
    const { SHARE_CHAMPIONS } = await vite.ssrLoadModule("/app/share-champion-ids.ts");
    const report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
    const [blueTeam, redTeam] = report.opponent_prep.teams;
    const manual = SHARE_CHAMPIONS.find(([, id]) => agent.applyDraftSelection([], id, [], "BLUE").length === 1)[1];
    let selections = agent.applyDraftSelection([], manual, [], "BLUE");
    const state = { report, blueTeam, redTeam, selections, previousPicks: [], firstPickSide: "BLUE", manualSide: "BLUE" };
    const choice = solo.suggestSoloDraftTurn(state), explanation = solo.explainSoloDraftTurn(state);
    assert.ok(choice && explanation);
    const context = history.soloHistoryContext(ui.soloAutoContext(blueTeam.team_id, redTeam.team_id, "BLUE", "BLUE", []), roster.basisKey(roster.rosterBasis(report)));
    const record = { turn: 2, champion_id: choice.champion_id, reason: choice.reason,
      prefix: [manual], context, explanation };
    selections = agent.applyDraftSelection(selections, choice.champion_id, [], "BLUE");
    const scenario = agent.serializeDraftScenario(report, blueTeam, redTeam, selections, [], null, "BLUE");
    const parsed = sessions.parseDraftSession(scenario);
    assert.ok(parsed.ok);
    const sha = "a".repeat(64), encoded = codec.serializeSoloReview(sha, "BLUE", [record]);
    assert.ok(encoded.ok);
    const restored = codec.parseSoloReview(encoded.text, parsed.session, sha);
    assert.ok(restored.ok);
    assert.deepEqual(restored.records, [record]);
    assert.ok(Object.isFrozen(restored.records[0].explanation.selected));
    assert.equal(codec.parseSoloReview(encoded.text, parsed.session, "b".repeat(64)).ok, false);
    const altered = structuredClone(parsed.session);
    altered.selections[0].champion_id = choice.champion_id;
    assert.equal(codec.parseSoloReview(encoded.text, altered, sha).ok, false);
    const forged = JSON.parse(encoded.text);
    forged.manual_side = "RED";
    assert.equal(codec.parseSoloReview(JSON.stringify(forged), parsed.session, sha).ok, false);
    assert.equal(agent.serializeDraftScenario(report, blueTeam, redTeam, selections, [], null, "BLUE"), scenario);
  } finally { await vite.close(); }
});
