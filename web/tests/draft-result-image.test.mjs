import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

test("draft result PNG display model", async (t) => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const img = await vite.ssrLoadModule("/app/draft-result-image.ts");
    const { buildDraftResultReport } = await vite.ssrLoadModule("/app/draft-result-report.ts");
    const { applyDraftSelection } = await vite.ssrLoadModule("/app/draft-agent.ts");
    const { sampleReport } = await vite.ssrLoadModule("/app/sample-report.ts");
    const ids = ["Aatrox", "Ahri", "Akali", "Alistar", "Amumu", "Anivia", "Wukong", "Kai'Sa", "Ashe", "Azir",
      "Bard", "Braum", "Brand", "Caitlyn", "Camille", "Corki", "Darius", "Diana", "Draven", "Ekko"];
    const nameOf = (id) => `이름:${id}`;
    function fixture() {
      const report = structuredClone(sampleReport);
      const [blueTeam, redTeam] = report.opponent_prep.teams;
      let selections = [];
      for (const id of ids) selections = applyDraftSelection(selections, id, [], "BLUE");
      const result = buildDraftResultReport({ report, blueTeam, redTeam, selections, previousPicks: [], firstPickSide: "BLUE" });
      return { result, selections, patchId: report.patch_id, dataCutoff: "2026-11-18T12:00:00Z", nameOf };
    }

    await t.test("READY model: order, cutoff, notice, no scores, deterministic, input unchanged", () => {
      const input = fixture();
      assert.equal(input.result.status, "READY");
      const before = structuredClone({ result: input.result, selections: input.selections });
      const model = img.buildDraftResultImageModel(input);
      assert.deepEqual({ result: input.result, selections: input.selections }, before);
      assert.equal(model.sides.length, 2);
      assert.deepEqual(model.sides[0].picks, input.result.sides[0].picks.map((p) => nameOf(p.champion_id)));
      const blueBans = input.selections.filter((s) => s.side === "BLUE" && s.kind === "BAN").map((s) => s.champion_id);
      assert.deepEqual(model.sides[0].bans, blueBans.map((id) => nameOf(id)));
      assert.equal(model.sides[1].bans.length, 5);
      assert.equal(model.cutoff_line, "자료 기준일 2026-11-18");
      assert.match(model.patch_line, /^패치 /);
      assert.equal(model.notice, "연습 결과 · 승패 예측 아님");
      assert.equal(/승률\s*\d|점수\s*\d|%|winner|score/i.test(img.serializeDraftResultImageModel(model)), false);
      assert.equal(img.serializeDraftResultImageModel(model), img.serializeDraftResultImageModel(img.buildDraftResultImageModel(fixture())));
      assert.equal(img.buildDraftResultImageModel({ ...input, dataCutoff: null }).cutoff_line, "자료 기준일 미확인");
    });

    await t.test("rejects non-READY", () => {
      const input = fixture();
      for (const status of ["INCOMPLETE", "INVALID"]) {
        assert.throws(() => img.buildDraftResultImageModel({ ...input, result: { ...input.result, status } }), /NOT_READY/);
      }
      assert.throws(() => img.buildDraftResultImageModel({ ...input, selections: input.selections.slice(0, 19) }), /NOT_READY/);
    });

    await t.test("long and empty team names", () => {
      assert.deepEqual(img.wrapTeamName(""), ["이름 없는 팀"]);
      assert.deepEqual(img.wrapTeamName("  \n\t "), ["이름 없는 팀"]);
      const long = img.wrapTeamName("가".repeat(50));
      assert.equal(long.length, 2);
      assert.ok(long.every((l) => [...l].length <= img.TEAM_LINE_CHARS));
      assert.ok(long[1].endsWith("…"));
      assert.deepEqual(img.wrapTeamName("T1"), ["T1"]);
      const input = fixture();
      input.result.sides[0].team_name = "";
      assert.deepEqual(img.buildDraftResultImageModel(input).sides[0].team_lines, ["이름 없는 팀"]);
    });

    await t.test("canvas double: all strings drawn, width fixed, overflow truncated", () => {
      const model = img.buildDraftResultImageModel(fixture());
      const calls = [];
      const ctx = { fillStyle: "", font: "", textBaseline: "", textAlign: "", fillRect() {},
        fillText(text) { calls.push(text); }, measureText(text) { return { width: [...text].length * 30 }; } };
      const canvas = { width: 0, height: 0, getContext: () => ctx };
      const drawn = img.renderDraftResultImage(model, canvas);
      assert.equal(canvas.width, 1080);
      assert.ok(canvas.height > 1000);
      assert.deepEqual(drawn, calls);
      for (const s of model.sides) for (const n of [...s.picks, ...s.bans, ...s.team_lines]) assert.ok(calls.some((c) => c.includes(n)), n);
      for (const n of [model.title, model.notice, model.patch_line, model.cutoff_line]) assert.ok(calls.includes(n));
      assert.ok(calls.every((c) => [...c].length * 30 <= 1080 - 128));
      assert.throws(() => img.renderDraftResultImage(model, { width: 0, height: 0, getContext: () => null }), /NO_CANVAS/);
    });

    const { teamPicks, championKey } = await vite.ssrLoadModule("/app/champion-roles.ts");
    const empty = () => ({ TOP: null, JUNGLE: null, MID: null, BOTTOM: null, SUPPORT: null });
    function positionFixture() {
      const input = fixture();
      const [blue, red] = input.result.sides;
      const bluePicks = teamPicks(input.selections, "BLUE");
      const redPicks = teamPicks(input.selections, "RED");
      return { input, blue, red, bluePicks, redPicks };
    }
    const rolesOf = (model, i) => model.sides[i].pick_roles;
    const allUnassigned = (model) => model.sides.every((s) => s.pick_roles.length === 5 && s.pick_roles.every((r) => r === "미배정"));

    await t.test("positions: partial assignment on both teams, alias IDs, pick order kept, input unchanged", () => {
      const { input, blue, red, bluePicks, redPicks } = positionFixture();
      assert.ok(redPicks.includes("Kaisa"));
      const positionRecord = {
        [blue.team_id]: { roles: { ...empty(), TOP: bluePicks[0], SUPPORT: bluePicks[3] }, unassigned: [bluePicks[1]] },
        [red.team_id]: { roles: { ...empty(), BOTTOM: "Kai'Sa" }, unassigned: [] },
      };
      const before = structuredClone({ result: input.result, selections: input.selections, positionRecord });
      const model = img.buildDraftResultImageModel({ ...input, positionRecord });
      assert.deepEqual({ result: input.result, selections: input.selections, positionRecord }, before);
      const legacy = img.buildDraftResultImageModel(input);
      for (const i of [0, 1]) assert.deepEqual(model.sides[i].picks, legacy.sides[i].picks);
      const key = championKey;
      const expectBlue = { [key(bluePicks[0])]: "탑", [key(bluePicks[3])]: "서포터" };
      assert.deepEqual(rolesOf(model, 0), blue.picks.map((p) => expectBlue[key(p.champion_id)] ?? "미배정"));
      assert.deepEqual(rolesOf(model, 1), red.picks.map((p) => key(p.champion_id) === "kaisa" ? "바텀" : "미배정"));
      assert.equal(rolesOf(model, 0).filter((r) => r !== "미배정").length, 2);
      // Detached: later edits to the caller's record never reach the built model.
      const frozen = img.serializeDraftResultImageModel(model);
      positionRecord[blue.team_id].roles.MID = bluePicks[2];
      assert.equal(img.serializeDraftResultImageModel(model), frozen);
      assert.equal(/승률\s*\d|점수\s*\d|%|winner|score/i.test(frozen), false);

      const calls = [];
      const ctx = { fillStyle: "", font: "", textBaseline: "", textAlign: "", fillRect() {},
        fillText(text) { calls.push(text); }, measureText(text) { return { width: [...text].length * 30 }; } };
      const canvas = { width: 0, height: 0, getContext: () => ctx };
      img.renderDraftResultImage(model, canvas);
      assert.equal(canvas.width, 1080);
      assert.ok(canvas.height > img.draftResultImageHeight(legacy));
      assert.equal(calls.filter((c) => c.startsWith("포지션 ")).length, 10);
      assert.ok(calls.includes("포지션 탑") && calls.includes("포지션 바텀") && calls.includes("포지션 미배정"));
      assert.ok(calls.every((c) => [...c].length * 30 <= 1080 - 128));
      assert.equal(model.sides.every((s) => s.picks.length === 5 && s.bans.length === 5), true);
    });

    await t.test("positions: legacy call without option keeps the exact old model", () => {
      const input = fixture();
      const model = img.buildDraftResultImageModel(input);
      assert.equal(model.sides.some((s) => "pick_roles" in s), false);
      assert.equal(img.serializeDraftResultImageModel(model).includes("pick_roles"), false);
      assert.equal(model.boundary_lines[1], "승률·점수·실력·포지션은 계산하거나 확정하지 않습니다.");
      assert.deepEqual(img.buildDraftResultImageModel({ ...input, positionRecord: undefined }), model);
    });

    await t.test("positions: none or explicitly cleared shows 미배정, observed roles are never used", () => {
      const { input, blue, bluePicks } = positionFixture();
      assert.ok(allUnassigned(img.buildDraftResultImageModel({ ...input, positionRecord: null })));
      assert.ok(allUnassigned(img.buildDraftResultImageModel({ ...input, positionRecord: {} })));
      const cleared = { [blue.team_id]: { roles: empty(), unassigned: [...bluePicks] } };
      assert.ok(allUnassigned(img.buildDraftResultImageModel({ ...input, positionRecord: cleared })));
      // Even if the result reports observed roles for every pick, they are not shown as assignments.
      const observed = structuredClone(input.result);
      for (const s of observed.sides) for (const p of s.picks) p.roles = ["TOP"];
      assert.ok(allUnassigned(img.buildDraftResultImageModel({ ...input, result: observed, positionRecord: null })));
    });

    await t.test("positions: foreign team, other side's pick, ban, swapped side or malformed record are not shown", () => {
      const { input, blue, red, bluePicks, redPicks } = positionFixture();
      const ban = input.selections.find((s) => s.kind === "BAN").champion_id;
      const bad = [
        { "other-team": { roles: { ...empty(), TOP: bluePicks[0] }, unassigned: [] } },
        { [blue.team_id]: { roles: { ...empty(), TOP: bluePicks[0] }, unassigned: [] }, "other-team": { roles: empty(), unassigned: [] } },
        { [blue.team_id]: { roles: { ...empty(), TOP: redPicks[0] }, unassigned: [] } },
        { [blue.team_id]: { roles: { ...empty(), TOP: ban }, unassigned: [] } },
        { [red.team_id]: { roles: { ...empty(), MID: bluePicks[1] }, unassigned: [] } },
        { [blue.team_id]: { roles: { ...empty(), TOP: bluePicks[0], MID: bluePicks[0] }, unassigned: [] } },
        { [blue.team_id]: { roles: { ...empty(), ADC: bluePicks[0] }, unassigned: [] } },
        { [blue.team_id]: { roles: { TOP: bluePicks[0] }, unassigned: [] } },
        [{ roles: empty(), unassigned: [] }],
        "TOP",
      ];
      for (const positionRecord of bad) {
        const before = structuredClone(positionRecord);
        assert.ok(allUnassigned(img.buildDraftResultImageModel({ ...input, positionRecord })), JSON.stringify(positionRecord));
        assert.deepEqual(positionRecord, before);
      }
      // BLUE/RED swap: the same teams on opposite sides; the old record no longer matches the new picks.
      const swapped = structuredClone(input.result);
      swapped.sides = swapped.sides.map((s, i) => ({ ...s, team_id: input.result.sides[1 - i].team_id }));
      const stale = { [blue.team_id]: { roles: { ...empty(), TOP: bluePicks[0] }, unassigned: [] } };
      assert.ok(allUnassigned(img.buildDraftResultImageModel({ ...input, result: swapped, positionRecord: stale })));
    });
  } finally { await vite.close(); }
});
