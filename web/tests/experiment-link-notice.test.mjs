import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const encode = (data) => Buffer.from(JSON.stringify(data), "utf8").toString("base64url");

test("experiment link notice: received #experiment= link on team selection", async (t) => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const N = await vite.ssrLoadModule("/app/experiment-link-notice.ts");
    const report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
    const teams = report.opponent_prep.teams.map(({ team_id, team_name }) => ({ team_id, team_name }));
    assert.ok(teams.length >= 4, "fixture needs at least four teams");
    const [x, y] = [teams[2].team_id, teams[3].team_id].sort();
    const name = (id) => teams.find((team) => team.team_id === id).team_name;
    const base = "https://example.test/pro-meta-intelligence/";
    const data = (over = {}) => ({ schema: "experiment-assumptions", version: 1, ruleset: "assumption-manager-v1", patch: report.patch_id, seed: 42,
      teams: [{ id: x, lane: 0.5, tempo: 0, teamfight: -0.25 }, { id: y, lane: 0, tempo: 1, teamfight: 0 }], ...over });
    const href = (over) => `${base}#experiment=${encode(data(over))}`;
    const ctx = (over = {}) => ({ teams, patch: report.patch_id, blueTeamId: teams[0].team_id, redTeamId: teams[1].team_id,
      hasWork: false, roomActive: false, ready: true, ...over });

    await t.test("no link or another hash → NONE", () => {
      for (const h of [base, `${base}#draft=abc`, `${base}#room=xyz`, "", "not a url"]) assert.deepEqual(N.experimentLinkNotice(h, ctx()), { kind: "NONE" }, h);
    });

    await t.test("valid link: two team names, value summary, seed, patch match, choosable", () => {
      const notice = N.experimentLinkNotice(href(), ctx());
      assert.equal(notice.kind, "RECEIVED");
      assert.deepEqual(notice.teams.map((team) => team.name), [name(x), name(y)]);
      assert.equal(N.noticeValuesText(notice.teams[0].values), "라인 0.5 · 운영 0 · 한타 -0.25");
      assert.equal(N.noticeValuesText(notice.teams[1].values), "라인 0 · 운영 1 · 한타 0");
      assert.equal(notice.seedText, "42");
      assert.equal(notice.patchMatches, true);
      assert.deepEqual(notice.choose, { ok: true, blueTeamId: x, redTeamId: y, alreadySelected: false });
    });

    await t.test("supported/unsupported scope never claims real effects", () => {
      assert.match(N.NOTICE_SUPPORTED, /두 팀 선택/);
      assert.match(N.NOTICE_SUPPORTED, /라인·운영·한타/);
      for (const word of ["밴·픽", "진영", "선수", "역할", "실행 결과"]) assert.ok(N.NOTICE_UNSUPPORTED.includes(word), word);
      assert.ok(N.NOTICE_NEXT_STEPS.join(" ").includes("직접"));
      for (const text of [N.NOTICE_SUPPORTED, N.NOTICE_UNSUPPORTED, ...N.NOTICE_NEXT_STEPS]) assert.equal(/승률|예측/.test(text), false, text);
    });

    await t.test("malformed links are INVALID with a reason, never choosable", () => {
      const cases = [
        [`${base}#experiment=***`, "BAD_ENCODING"],
        [`${base}#experiment=${encode({ hello: 1 })}`, "BAD_SHAPE"],
        [href({ version: 2 }), "BAD_VERSION"],
        [href({ ruleset: "other-v9" }), "BAD_RULESET"],
        [href({ seed: -1 }), "BAD_VALUE"],
        [href({ teams: [{ id: x, lane: 2, tempo: 0, teamfight: 0 }, { id: y, lane: 0, tempo: 0, teamfight: 0 }] }), "BAD_VALUE"],
        [href({ teams: [{ id: y, lane: 0, tempo: 0, teamfight: 0 }, { id: x, lane: 0, tempo: 0, teamfight: 0 }] }), "BAD_TEAMS"],
        [`${base}#experiment=${"A".repeat(5000)}`, "TOO_LONG"],
      ];
      for (const [h, reason] of cases) {
        const notice = N.experimentLinkNotice(h, ctx());
        assert.equal(notice.kind, "INVALID", reason);
        assert.equal(notice.reason, reason);
        assert.ok(notice.message.length > 0);
      }
    });

    await t.test("team missing from current data → MISSING_TEAM, name null", () => {
      const ghost = "zz:not-a-team";
      const notice = N.experimentLinkNotice(href({ teams: [{ id: x, lane: 0, tempo: 0, teamfight: 0 }, { id: ghost, lane: 0, tempo: 0, teamfight: 0 }] }), ctx());
      assert.equal(notice.kind, "RECEIVED");
      assert.equal(notice.teams[1].name, null);
      assert.deepEqual(notice.choose, { ok: false, reason: "MISSING_TEAM" });
    });

    await t.test("different patch → shown but not choosable (the values could not be applied later)", () => {
      const notice = N.experimentLinkNotice(href({ patch: "0.01" }), ctx());
      assert.equal(notice.patchMatches, false);
      assert.deepEqual(notice.choose, { ok: false, reason: "PATCH_MISMATCH" });
    });

    await t.test("work in progress blocks overwriting the teams", () => {
      assert.deepEqual(N.experimentLinkNotice(href(), ctx({ hasWork: true })).choose, { ok: false, reason: "IN_PROGRESS" });
      assert.match(N.CHOOSE_REFUSAL_TEXT.IN_PROGRESS, /새 시리즈 시작/);
    });

    await t.test("already the link's teams (either side) → no change needed, even with work", () => {
      for (const [blue, red] of [[x, y], [y, x]]) {
        for (const hasWork of [false, true]) {
          assert.deepEqual(N.experimentLinkNotice(href(), ctx({ blueTeamId: blue, redTeamId: red, hasWork })).choose,
            { ok: true, blueTeamId: blue, redTeamId: red, alreadySelected: true });
        }
      }
    });

    await t.test("one link team already selected keeps its side", () => {
      const other = teams[0].team_id;
      assert.deepEqual(N.decideChooseTeams(data(), ctx({ blueTeamId: other, redTeamId: x })), { ok: true, blueTeamId: y, redTeamId: x, alreadySelected: false });
      assert.deepEqual(N.decideChooseTeams(data(), ctx({ blueTeamId: y, redTeamId: other })), { ok: true, blueTeamId: y, redTeamId: x, alreadySelected: false });
      assert.deepEqual(N.decideChooseTeams(data(), ctx({ blueTeamId: other, redTeamId: y })), { ok: true, blueTeamId: x, redTeamId: y, alreadySelected: false });
    });

    await t.test("room and loading block choosing", () => {
      assert.deepEqual(N.experimentLinkNotice(href(), ctx({ roomActive: true })).choose, { ok: false, reason: "ROOM" });
      assert.deepEqual(N.experimentLinkNotice(href(), ctx({ ready: false })).choose, { ok: false, reason: "NOT_READY" });
    });

    await t.test("pure: inputs are not mutated", () => {
      const c = ctx();
      const before = structuredClone(c);
      N.experimentLinkNotice(href(), c);
      assert.deepEqual(c, before);
    });
  } finally {
    await vite.close();
  }
});
