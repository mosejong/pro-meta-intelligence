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
  } finally { await vite.close(); }
});
