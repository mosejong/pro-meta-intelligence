import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("exchange branches preserve legality, readiness, locks and the real draft", async (t) => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { compareDraftExchange, ownPreparationOptions } = await vite.ssrLoadModule("/app/draft-exchange.ts");
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
    const paired = structuredClone(pack);
    const pair = { left: { role: "JUNGLE", champion_id: "Vi" }, right: { role: "SUPPORT", champion_id: "Lulu" }, game_count: 2, evidence_match_ids: ["one", "two"] };
    paired.target.observed_pairs = [pair];
    paired.own.observed_pairs = [pair];
    const readyPair = { ...context, prepared: [...prepared, { role: "SUPPORT", champion_id: "Lulu" }] };
    const combos = compareDraftExchange(paired, focus, readyPair);
    assert.equal(branch(combos, "OPEN").opponentPairs.length, 1);
    assert.equal(branch(combos, "BAN").opponentPairs.length, 0);
    assert.equal(branch(combos, "SECURE").ownPairs.length, 1);
    const blockedPair = compareDraftExchange(paired, focus, { ...readyPair, previousPicks: ["Lulu"] });
    assert.ok(blockedPair.branches.every((b) => b.opponentPairs.length === 0 && b.ownPairs.length === 0));
    const notReadyPair = compareDraftExchange(paired, focus, context);
    assert.ok(notReadyPair.branches.every((b) => b.ownPairs.length === 0));
    const html = renderToStaticMarkup(createElement(DraftExchangePanel, { pack, ...context, nameOf: (id) => id }));
    assert.match(html, /밴·오픈·선점 비교/);
    assert.match(html, /준비 확인된 가용 카드 없음/);
    assert.doesNotMatch(html, /type="checkbox" checked/);

    await t.test("committed flex champions retain separate historical-role preparation status", () => {
      const flex = structuredClone(pack);
      flex.own.observed_pairs = [{ ...pair,
        left: { role: "TOP", champion_id: "Jayce" },
      }];
      // Both champions are committed; neither champion's role is assigned by the draft.
      let committed = selections.slice(0, 6);
      for (const id of ["Jayce", "Lee Sin", "Nami", "Lulu"]) committed = applyDraftSelection(committed, id);
      const flexFocus = { role: "JUNGLE", champion_id: "Jarvan IV" };
      const flexContext = { ...context, selections: committed,
        prepared: [{ role: "MID", champion_id: "Jayce" }] };
      const result = compareDraftExchange(flex, flexFocus, flexContext);
      const observed = branch(result, "OPEN").ownPairs[0];
      assert.ok(observed);
      assert.equal(observed.left.committed, true);
      assert.equal(observed.left.role, "TOP");
      assert.equal(observed.left.rolePrepared, false);
      assert.equal(observed.right.rolePrepared, false);
      const confirmed = compareDraftExchange(flex, flexFocus, { ...flexContext,
        prepared: [...flexContext.prepared, { role: "TOP", champion_id: "Jayce" }] });
      assert.equal(branch(confirmed, "OPEN").ownPairs[0].left.rolePrepared, true);
      const flexHtml = renderToStaticMarkup(createElement(DraftExchangePanel, { pack: flex, ...flexContext, nameOf: (id) => id }));
      assert.match(flexHtml, /Jayce \(탑 기록 · 챔피언 픽 확정 · 해당 역할 준비 미확인\)/);
      assert.doesNotMatch(flexHtml, /우리 준비와 맞는 동시 사용 조합/);
      assert.ok(result.branches.every((b) => b.own.every((c) => c.champion_id !== "Jayce")));
    });

    await t.test("actual own pair evidence exposes off-pool preparation without inferring other roles", () => {
      const historical = pack.own.observed_pairs.find((p) =>
        p.left.champion_id === "Kai'Sa" && p.left.role === "BOTTOM" && p.right.champion_id === "Olaf");
      assert.ok(historical?.evidence_match_ids.length);
      assert.ok(!pack.own.player_pools.find((g) => g.role === "BOTTOM").champions.some((c) => c.champion_id === "Kai'Sa"));
      const options = ownPreparationOptions(pack);
      assert.equal(options.filter((c) => c.role === "BOTTOM" && c.champion_id === "Kai'Sa").length, 1);
      assert.ok(!options.some((c) => c.role === "MID" && c.champion_id === "Kai'Sa"));
      const bottomFieldset = html.match(/<fieldset><legend>우리 바텀 준비 확인[\s\S]*?<\/fieldset>/)?.[0];
      assert.match(bottomFieldset, /type="checkbox"[^>]*\/>Kai&#x27;Sa<\/label>/);
      assert.doesNotMatch(bottomFieldset, /checked/);

      const offPool = structuredClone(pack);
      const offFocus = historical.left;
      offPool.levers.expected_picks = [{ role: "BOTTOM", player_name: null,
        champions: [{ champion_id: offFocus.champion_id, score: 1, player_game_count: 1, meta_pick_share: null }] }];
      const offContext = { ...context, prepared: [historical.left, historical.right] };
      const ownBefore = JSON.stringify(offPool);
      const offResult = compareDraftExchange(offPool, offFocus, offContext);
      assert.ok(branch(offResult, "SECURE").ownPairs.some((p) => p.left.champion_id === "Kai'Sa" && p.right.champion_id === "Olaf" && p.left.rolePrepared && p.right.rolePrepared));
      let bans = [];
      for (const id of ["Aatrox", "Ahri", "Akali", "Alistar", "Amumu", "Anivia"]) bans = applyDraftSelection(bans, id);
      assert.equal(branch(compareDraftExchange(offPool, offFocus, { ...offContext, selections: bans }), "SECURE").legalNow, true);
      assert.equal(branch(compareDraftExchange(offPool, offFocus, { ...offContext, selections: bans,
        prepared: [{ ...offFocus, role: "MID" }, historical.right] }), "SECURE").legalNow, false);
      const lockedOffPool = compareDraftExchange(offPool, offFocus, { ...offContext, previousPicks: ["Kai'Sa"] });
      assert.ok(lockedOffPool.branches.every((b) => !b.legalNow && b.ownPairs.every((p) => p.left.champion_id !== "Kai'Sa" && p.right.champion_id !== "Kai'Sa")));
      const withoutOwnEvidence = structuredClone(offPool);
      withoutOwnEvidence.own.observed_pairs = [];
      assert.ok(!ownPreparationOptions(withoutOwnEvidence).some((c) => c.champion_id === "Kai'Sa"));
      assert.equal(branch(compareDraftExchange(withoutOwnEvidence, offFocus, { ...offContext, selections: bans }), "SECURE").legalNow, false);
      assert.equal(JSON.stringify(offPool), ownBefore);
    });
  } finally { await vite.close(); }
});

test("all seven packs keep locks, readiness and committed picks consistent under hard drafts", async () => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { compareDraftExchange, ownPreparationOptions } = await vite.ssrLoadModule("/app/draft-exchange.ts");
    const { draftScoutFor, buildDraftScoutBrief, DRAFT_SCOUT_PACKS } = await vite.ssrLoadModule("/app/draft-scout.ts");
    const { applyDraftSelection, isChampionLocked } = await vite.ssrLoadModule("/app/draft-agent.ts");
    const { championAssetId } = await vite.ssrLoadModule("/app/champion-assets.ts");
    const k = (id) => championAssetId(id).toLowerCase();
    const codes = Object.keys(DRAFT_SCOUT_PACKS);
    assert.equal(codes.length, 7);
    let scenarios = 0;
    for (const code of codes) {
      const pack = draftScoutFor(code);
      // Only half of the observed cards are confirmed, so readiness gating is exercised.
      const prepared = ownPreparationOptions(pack).filter((_, i) => i % 2 === 0);
      const isPrepared = (role, id) => prepared.some((p) => p.role === role && k(p.champion_id) === k(id));
      for (const group of pack.levers.expected_picks) for (const top of group.champions.slice(0, 2)) {
        const focus = { role: group.role, champion_id: top.champion_id };
        const others = pack.levers.expected_picks.flatMap((g) => g.champions.map((c) => c.champion_id))
          .filter((id) => k(id) !== k(focus.champion_id));
        const drafts = [
          { selections: [], previousPicks: [] },
          // Fearless: the focus was picked in an earlier game, written as an asset ID.
          { selections: [], previousPicks: [championAssetId(focus.champion_id), others[0]] },
          { selections: applyDraftSelection([], focus.champion_id), previousPicks: [] },
          { selections: others.slice(0, 8).reduce((s, id) => applyDraftSelection(s, id, others.slice(8, 11)), []),
            previousPicks: others.slice(8, 11) },
        ];
        for (const ownSide of ["BLUE", "RED"]) for (const { selections, previousPicks } of drafts) {
          scenarios += 1;
          const locked = (id) => isChampionLocked(selections, id, previousPicks);
          const picked = (own) => new Set(selections.filter((s) => s.kind === "PICK" && (s.side === ownSide) === own).map((s) => k(s.champion_id)));
          const [ownPicked, opponentPicked] = [picked(true), picked(false)];
          const r = compareDraftExchange(pack, focus, { selections, previousPicks, ownSide, firstPickSide: "BLUE", prepared });
          const where = `${code} ${focus.role} ${focus.champion_id} ${ownSide} ${selections.length}/${previousPicks.length}`;
          if (locked(focus.champion_id)) assert.ok(!r.available && r.branches.every((b) => !b.legalNow), where);
          for (const b of r.branches) {
            for (const c of [...b.opponent, ...b.own]) assert.ok(!locked(c.champion_id), `${where} ${b.action} ${c.champion_id}`);
            for (const c of b.own) assert.ok(isPrepared(focus.role, c.champion_id), `${where} unprepared ${c.champion_id}`);
            for (const p of b.opponentPairs) for (const c of [p.left, p.right]) {
              assert.ok(!locked(c.champion_id) || opponentPicked.has(k(c.champion_id)), `${where} opponent pair ${c.champion_id}`);
              if (b.action !== "OPEN") assert.notEqual(k(c.champion_id), k(focus.champion_id), where);
            }
            for (const p of b.ownPairs) for (const c of [p.left, p.right]) {
              assert.ok(!locked(c.champion_id) || ownPicked.has(k(c.champion_id)), `${where} own pair ${c.champion_id}`);
              assert.equal(c.committed, ownPicked.has(k(c.champion_id)), where);
              assert.equal(c.rolePrepared, isPrepared(c.role, c.champion_id), where);
              assert.ok(c.committed || c.rolePrepared, `${where} unsupported own card ${c.champion_id}`);
            }
          }
        }
      }
      const previous = pack.levers.expected_picks.map((g) => g.champions[0].champion_id);
      const brief = buildDraftScoutBrief(pack, previous, []);
      for (const id of [...brief.expected_picks.flatMap((g) => g.champions), ...brief.expected_bans].map((c) => c.champion_id)) {
        assert.ok(!previous.some((p) => k(p) === k(id)), `${code} brief keeps fearless-locked ${id}`);
      }
    }
    assert.ok(scenarios >= 500);
  } finally { await vite.close(); }
});
