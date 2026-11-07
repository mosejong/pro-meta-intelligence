import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("exchange branches preserve legality, readiness, locks and the real draft", async () => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { compareDraftExchange } = await vite.ssrLoadModule("/app/draft-exchange.ts");
    const { DraftExchangePanel } = await vite.ssrLoadModule("/app/draft-exchange-panel.tsx");
    const { draftScoutFor } = await vite.ssrLoadModule("/app/draft-scout.ts");
    const { applyDraftSelection } = await vite.ssrLoadModule("/app/draft-agent.ts");
    const pack = draftScoutFor("KC");
    const focus = { role: "JUNGLE", champion_id: "Vi" };
    const ownPool = pack.own.player_pools.find((group) => group.role === focus.role);
    assert.ok(ownPool.champions.some((c) => c.champion_id === focus.champion_id));
    const prepared = ownPool.champions.map((c) => ({ role: focus.role, champion_id: c.champion_id }));
    const context = { selections: [], previousPicks: [], ownSide: "BLUE", firstPickSide: "BLUE", prepared };
    const before = JSON.stringify({ pack, context });
    const result = compareDraftExchange(pack, focus, context);
    const branch = (r, action) => r.branches.find((b) => b.action === action);
    assert.equal(branch(result, "BAN").legalNow, true);
    assert.equal(branch(result, "OPEN").legalNow, false);
    assert.equal(branch(result, "SECURE").legalNow, false);
    for (const action of ["BAN", "OPEN"]) {
      assert.ok(branch(result, action).own.every((c) => c.champion_id !== focus.champion_id));
    }
    assert.ok(branch(result, "BAN").opponent.every((c) => c.champion_id !== focus.champion_id));
    assert.ok(branch(result, "OPEN").opponent.some((c) => c.champion_id === focus.champion_id));
    assert.equal(JSON.stringify({ pack, context }), before);
    const noReadiness = compareDraftExchange(pack, focus, { ...context, prepared: [] });
    assert.ok(noReadiness.branches.every((b) => b.own.length === 0));
    const swapped = compareDraftExchange(pack, focus, { ...context, ownSide: "RED", firstPickSide: "RED" });
    assert.equal(branch(swapped, "BAN").legalNow, true);
    const notOurTurn = compareDraftExchange(pack, focus, { ...context, ownSide: "RED" });
    assert.ok(notOurTurn.branches.every((b) => !b.legalNow));
    const locked = compareDraftExchange(pack, focus, { ...context, previousPicks: ["Vi"] });
    assert.equal(locked.available, false);
    assert.ok(locked.branches.every((b) => !b.legalNow));
    let selections = [];
    for (const id of ["Aatrox", "Ahri", "Akali", "Alistar", "Amumu", "Anivia"]) selections = applyDraftSelection(selections, id);
    const pickTurn = compareDraftExchange(pack, focus, { ...context, selections });
    assert.equal(branch(pickTurn, "SECURE").legalNow, true);
    const wrongRole = compareDraftExchange(pack, focus, { ...context, selections, prepared: [{ role: "TOP", champion_id: "Vi" }] });
    assert.equal(branch(wrongRole, "SECURE").legalNow, false);
    selections = applyDraftSelection(selections, "Vi");
    const selected = compareDraftExchange(pack, focus, { ...context, selections });
    assert.equal(selected.available, false);
    assert.ok(selected.branches.every((b) => !b.legalNow));
    const unknown = compareDraftExchange(pack, { role: "JUNGLE", champion_id: "UNKNOWN" }, context);
    assert.equal(unknown.available, false);
    const html = renderToStaticMarkup(createElement(DraftExchangePanel, { pack, ...context, nameOf: (id) => id }));
    assert.match(html, /밴·오픈·선점 비교/);
    assert.match(html, /준비 확인된 가용 카드 없음/);
    assert.doesNotMatch(html, /type="checkbox" checked/);
  } finally { await vite.close(); }
});
