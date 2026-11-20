import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

test("series recap plain-text share", async (t) => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { buildSeriesRecap: recap } = await vite.ssrLoadModule("/app/draft-series-recap.ts");
    const { buildSeriesRecapText: share, cleanShareName } = await vite.ssrLoadModule("/app/draft-series-recap-text.ts");
    const { applyDraftSelection } = await vite.ssrLoadModule("/app/draft-agent.ts");
    const { sampleReport } = await vite.ssrLoadModule("/app/sample-report.ts");
    const { SHARE_CHAMPIONS } = await vite.ssrLoadModule("/app/share-champion-ids.ts");
    const pool = SHARE_CHAMPIONS.map(([, id]) => id);
    const teams = sampleReport.opponent_prep.teams;
    const [A, B] = teams.map((team) => team.team_id);
    const teamName = new Map(teams.map((team) => [team.team_id, team.team_name]));
    function play(ids, firstPickSide = "BLUE") {
      let selections = [];
      for (const id of ids) {
        const next = applyDraftSelection(selections, id, [], firstPickSide);
        assert.notEqual(next, selections, `fixture turn ${selections.length + 1} rejected ${id}`);
        selections = next;
      }
      return selections;
    }
    const game = (blue, red, ids, first) => ({ blue_team_id: blue, red_team_id: red, selections: play(ids, first) });
    const ids1 = pool.slice(0, 20), ids2 = pool.slice(20, 40), ids3 = pool.slice(40, 60);
    const series = () => ({ report: structuredClone(sampleReport), games: [game(A, B, ids1, "BLUE"), game(B, A, ids2, "RED")] });
    const nameOf = (id) => `N:${id}`;
    const base = (r) => ({ recap: r, patchId: "26.22", cutoff: "2026-11-18", nameOf });
    const headers = (text) => text.split("\n").filter((line) => line.startsWith("["));

    await t.test("set order, Red first pick, side swap and lock counts", () => {
      const r = recap(series());
      const out = share(base(r));
      assert.equal(out.ok, true);
      assert.equal(out.game_count, 2);
      const [h1, h2] = headers(out.text);
      assert.equal(h1, `[1세트] 블루 ${teamName.get(A)} vs 레드 ${teamName.get(B)} · 선픽 블루`);
      assert.equal(h2, `[2세트] 블루 ${teamName.get(B)} vs 레드 ${teamName.get(A)} · 선픽 레드`);
      assert.ok(out.text.indexOf(h1) < out.text.indexOf(h2));
      assert.match(out.text, /이 세트 전 잠금 0개 · 다음 세트부터 잠기는 픽 10개/);
      assert.match(out.text, /이 세트 전 잠금 10개 · 다음 세트부터 잠기는 픽 10개/);
      assert.match(out.text, /지금까지 잠긴 챔피언 20개: /);
      assert.equal((out.text.match(/ 픽 5: /g) ?? []).length, 4);
      assert.equal((out.text.match(/ 밴 5: /g) ?? []).length, 4);
      for (const id of r.games[1].sides[0].picks) assert.ok(out.text.includes(`N:${id}`));
      assert.match(out.text, /자료 기준: 패치 26\.22 · 기준일 2026-11-18/);
      assert.match(out.text, /선수 구성과 명시 포지션은 이 요약 범위가 아니에요/);
      assert.match(out.text, /경기 승패·승률 계산이나 예측이 아니에요/);
      assert.equal(/[{}"]|champion_id|team_id|status/.test(out.text), false, "no raw JSON or row fields");
      assert.equal(out.text.includes(A) || out.text.includes(B), false, "raw team IDs are not exported");
    });

    await t.test("incomplete current game is excluded; a finished current is included once via recap", () => {
      const input = series();
      const done = game(A, B, ids3, "BLUE");
      const partial = share(base(recap({ ...input, current: { ...done, selections: done.selections.slice(0, 19) } })));
      assert.equal(partial.game_count, 2);
      assert.equal(headers(partial.text).length, 2);
      const finished = share(base(recap({ ...input, current: done })));
      assert.equal(finished.game_count, 3);
      assert.equal(headers(finished.text)[2], `[3세트 · 방금 완료] 블루 ${teamName.get(A)} vs 레드 ${teamName.get(B)} · 선픽 블루`);
      assert.match(finished.text, /지금까지 잠긴 챔피언 30개/);
    });

    await t.test("no finished game, an unsupported game or unverified total refuses the whole share", () => {
      assert.deepEqual(share(base(recap({ report: sampleReport, games: [] }))), { ok: false, reason: "NO_FINISHED_GAME" });
      const bad = series(); bad.games[1].blue_team_id = "synthetic:team:absent";
      const r = recap(bad);
      assert.equal(r.games[0].status, "READY");
      assert.deepEqual(share(base(r)), { ok: false, reason: "UNSUPPORTED_GAME" });
      const good = recap(series());
      assert.deepEqual(share(base({ ...good, total_locks: null })), { ok: false, reason: "UNVERIFIED_TOTAL" });
      assert.deepEqual(share(base({ games: "x", total_locks: [] })), { ok: false, reason: "INVALID_RECAP" });
      const shuffled = { ...good, games: [good.games[1], good.games[0]] };
      assert.deepEqual(share(base(shuffled)), { ok: false, reason: "INVALID_RECAP" });
    });

    await t.test("team and champion names are cleaned and length-limited", () => {
      assert.equal(cleanShareName("A‮evil⁦\nB\r\u0000C​ D"), "A evil B C D");
      assert.equal(cleanShareName(42), "");
      const long = "가".repeat(100);
      assert.equal(Array.from(cleanShareName(long)).length, 40);
      assert.ok(cleanShareName(long).endsWith("…"));
      const r = recap(series());
      r.games[0].sides[0].team_name = "Evil‮\nTeam\u0007";
      const out = share({ ...base(r), patchId: "26.22\n‮injected", nameOf: (id) => id === r.games[0].sides[0].picks[0] ? `X⁧\r\n${long}` : (() => { throw new Error("x"); })() });
      assert.equal(out.ok, true);
      assert.equal(Array.from(out.text).some(ch => { const cp = ch.codePointAt(0); return (cp < 32 && cp !== 10) || cp === 127 || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069) || cp === 0x2028 || cp === 0x2029; }), false);
      assert.ok(out.text.includes("블루 Evil Team 픽 5"));
      assert.ok(out.text.includes("패치 26.22 injected"));
      assert.ok(out.text.includes(`X ${"가".repeat(37)}…`));
      assert.ok(out.text.includes(r.games[0].sides[0].picks[1]), "throwing nameOf falls back to the cleaned ID");
      assert.ok(out.text.split("\n").every((line) => !line.startsWith("Team")), "names cannot inject new lines");
      assert.match(share({ ...base(recap(series())), patchId: "", cutoff: "\u0000" }).text, /패치 미확인 · 기준일 미확인/);
    });

    await t.test("input is not mutated and output is deterministic", () => {
      const r = recap(series());
      const before = structuredClone(r);
      const a = share(base(r));
      const b = share(base(r));
      assert.deepEqual(r, before);
      assert.deepEqual(a, b);
      assert.deepEqual(share(base(structuredClone(before))), a);
    });
  } finally { await vite.close(); }
});
