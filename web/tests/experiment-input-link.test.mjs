import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("assumption-only link: create, parse, gate and apply", async (t) => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const L = await vite.ssrLoadModule("/app/experiment-input-link.ts");
    const E = await vite.ssrLoadModule("/app/experiment-replay.ts");
    const S = await vite.ssrLoadModule("/app/simulation-scenario.ts");
    const R = await vite.ssrLoadModule("/app/roster-scenario.ts");
    const D = await vite.ssrLoadModule("/app/draft-share.ts");
    const { applyDraftSelection } = await vite.ssrLoadModule("/app/draft-agent.ts");
    const { ExperimentInputLinkPanel } = await vite.ssrLoadModule("/app/experiment-input-link-panel.tsx");
    const report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
    const ROLES = R.ROSTER_ROLES;
    const selections = Array.from({ length: 20 }, (_, i) => `champ${i}`).reduce((all, id) => applyDraftSelection(all, id, [], "BLUE"), []);
    const players = [...R.buildRosterIndex(report.opponent_prep.teams).players.values()];
    const snapshotOf = (blue, red) => {
      const ids = [blue.team_id, red.team_id];
      const rosters = Object.fromEntries(ids.map((id, n) => [id, Object.fromEntries(ROLES.map((role, r) => {
        const p = players[n * 5 + r]; return [role, { source_team_id: p.source_team_id, player_id: p.player_id }];
      }))]));
      const roleOf = (side) => { const p = S.teamPicks(selections, side); return Object.fromEntries(ROLES.map((role, i) => [role, p[i]])); };
      const result = S.buildSimulationReadiness({ report, blueTeam: blue, redTeam: red, selections, games: [], firstPickSide: "BLUE",
        roster: { basis: R.rosterBasis(report), teamIds: ids.slice().sort(), rosters }, roles: { [blue.team_id]: roleOf("BLUE"), [red.team_id]: roleOf("RED") } });
      assert.equal(result.ok, true, JSON.stringify(result.issues));
      return structuredClone(result.snapshot);
    };
    const [teamA, teamB, teamC] = report.opponent_prep.teams;
    const snapshot = snapshotOf(teamA, teamB);
    const [first, second] = [teamA.team_id, teamB.team_id].sort((x, y) => x < y ? -1 : 1);
    let counter = 0;
    const runOf = (snap, seed, drafts) => { const r = E.buildExperimentRun(++counter, snap, seed, drafts); assert.equal(r.ok, true, JSON.stringify(r.issues)); return r.run; };
    const HREF = "https://example.test/studio?x=1#draft=abc";
    const enc = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value), "utf8").toString("base64url");
    const hrefOf = (value) => `https://example.test/studio#experiment=${enc(value)}`;
    const decoded = (url) => JSON.parse(Buffer.from(new URL(url).hash.slice("#experiment=".length), "base64url").toString("utf8"));
    const numbers = { [teamA.team_id]: { lane: 0.5, tempo: -0.2, teamfight: 1 }, [teamB.team_id]: { lane: -1, tempo: 0, teamfight: 0.3 } };
    const baseData = () => ({ schema: "experiment-assumptions", version: 1, ruleset: "assumption-manager-v1", patch: snapshot.patch, seed: 7,
      teams: [first, second].map((id) => ({ id, ...numbers[id] })) });
    const drafts = { [teamA.team_id]: { lane: "0.5", tempo: "-0.2", teamfight: "1" }, [teamB.team_id]: { lane: "-1", tempo: "0", teamfight: "0.3" } };

    await t.test("completed trusted run → link with only assumption fields; round trip", () => {
      const run = runOf(snapshot, "7", structuredClone(drafts));
      const made = L.createExperimentInputLink(HREF, run, run.endMinute);
      assert.equal(made.ok, true, made.reason);
      assert.ok(made.url.startsWith("https://example.test/studio#experiment="), "search dropped, own hash only");
      const data = decoded(made.url);
      assert.deepEqual(Object.keys(data), ["schema", "version", "ruleset", "patch", "seed", "teams"]);
      assert.deepEqual(data.teams.map((team) => Object.keys(team)), [["id", "lane", "tempo", "teamfight"], ["id", "lane", "tempo", "teamfight"]]);
      assert.deepEqual(data.teams.map((team) => team.id), [first, second]);
      for (const core of E.CORE_TEAM_IDS) {
        const team = data.teams[core === "team_a" ? 0 : 1];
        assert.equal(team.id, run.teams[core].sourceId);
        for (const field of E.ASSUMPTION_FIELDS) assert.equal(team[field], run.teams[core].assumptions[field]);
      }
      assert.equal(data.seed, 7);
      const text = JSON.stringify(data);
      const leaks = ["champ", "player", "roster", "roles", "evidence", "result", "winner", "events", "states", "BLUE", "RED", "snapshot",
        ...players.slice(0, 10).map((p) => p.player_id),
        ...[teamA.team_name, teamB.team_name].filter((name) => name && !first.includes(name) && !second.includes(name) && !snapshot.patch.includes(name))];
      for (const leak of leaks) assert.ok(!text.includes(leak), `payload leaked ${leak}`);
      const back = L.parseExperimentInputLink(made.url);
      assert.equal(back.ok, true);
      assert.ok(L.sameLink(back.link, made.link));
      assert.equal(L.createExperimentInputLink("http://localhost:3000/", run, run.endMinute).ok, true);
      assert.equal(L.createExperimentInputLink("http://127.0.0.1:5173/", run, run.endMinute).ok, true);
    });

    await t.test("only trusted, completed runs; unsafe origins refused", () => {
      const run = runOf(snapshot, "7", structuredClone(drafts));
      assert.equal(L.createExperimentInputLink(HREF, run, run.endMinute - 1).reason, "NOT_COMPLETE");
      assert.equal(L.createExperimentInputLink(HREF, run, Number.NaN).reason, "NOT_COMPLETE");
      assert.equal(L.createExperimentInputLink(HREF, structuredClone(run), run.endMinute).reason, "NOT_TRUSTED");
      assert.equal(L.createExperimentInputLink(HREF, JSON.parse(JSON.stringify(run)), run.endMinute).reason, "NOT_TRUSTED");
      assert.equal(L.createExperimentInputLink(HREF, { ...run }, run.endMinute).reason, "NOT_TRUSTED");
      assert.equal(L.createExperimentInputLink(HREF, null, 0).reason, "NOT_TRUSTED");
      assert.equal(L.createExperimentInputLink(HREF, E.cloneTrustedRun(run), run.endMinute).ok, true);
      for (const bad of ["http://example.test/", "file:///C:/x.html", "ftp://example.test/", "http://192.168.0.2/"]) {
        assert.equal(L.createExperimentInputLink(bad, run, run.endMinute).reason, "UNSAFE_ORIGIN", bad);
      }
      assert.equal(L.createExperimentInputLink("not a url", run, run.endMinute).reason, "BAD_URL");
    });

    await t.test("link uses the run's fixed values, not later input changes", () => {
      const d = structuredClone(drafts);
      const snap = structuredClone(snapshot);
      const run = runOf(snap, "7", d);
      d[teamA.team_id].lane = "-0.9";
      d[teamB.team_id].teamfight = "0";
      snap.patch = "changed";
      const made = L.createExperimentInputLink(HREF, run, run.endMinute);
      assert.equal(made.ok, true);
      assert.deepEqual(decoded(made.url), baseData());
    });

    await t.test("apply plan: strict parser texts, same core result, source-ID mapping across side swap", () => {
      const run = runOf(snapshot, "7", structuredClone(drafts));
      const link = L.parseExperimentInputLink(L.createExperimentInputLink(HREF, run, run.endMinute).url).link;
      const plan = L.planExperimentLinkApply(link, snapshot, false);
      assert.equal(plan.ok, true, plan.reason);
      assert.equal(plan.seedText, "7");
      assert.deepEqual(Object.keys(plan.drafts).sort(), [first, second]);
      for (const draft of Object.values(plan.drafts)) for (const field of E.ASSUMPTION_FIELDS) assert.equal(E.parseAssumption(draft[field]).ok, true);
      const again = runOf(snapshot, plan.seedText, plan.drafts);
      assert.deepEqual(again.input, run.input);
      assert.deepEqual(again.result, run.result);
      const swapped = snapshotOf(teamB, teamA);
      const swappedPlan = L.planExperimentLinkApply(link, swapped, false);
      assert.equal(swappedPlan.ok, true);
      assert.deepEqual(swappedPlan.drafts, plan.drafts, "teams are matched by source ID, not by side");
      assert.deepEqual(swappedPlan.drafts[teamA.team_id], drafts[teamA.team_id]);
      const swappedRun = runOf(swapped, swappedPlan.seedText, swappedPlan.drafts);
      assert.deepEqual(swappedRun.result, run.result);
      assert.notEqual(swappedRun.teams.team_a.sideAtRun, run.teams.team_a.sideAtRun);
    });

    await t.test("gate: not ready, blocked, other patch or other team pair → no apply", () => {
      const link = L.validateLinkData(baseData()).link;
      assert.equal(L.planExperimentLinkApply(link, null, false).reason, "NO_READY_INPUT");
      assert.equal(L.planExperimentLinkApply(link, snapshot, true).reason, "BLOCKED");
      assert.equal(L.planExperimentLinkApply(link, null, true).reason, "BLOCKED");
      const otherPatch = structuredClone(snapshot); otherPatch.patch = `${snapshot.patch}-other`;
      assert.equal(L.planExperimentLinkApply(link, otherPatch, false).reason, "PATCH_MISMATCH");
      assert.equal(L.planExperimentLinkApply(link, snapshotOf(teamA, teamC), false).reason, "TEAM_MISMATCH");
    });

    await t.test("parse refuses wrong shape, version, ruleset, teams, values and extra keys", () => {
      assert.equal(L.parseExperimentInputLink(hrefOf(baseData())).ok, true);
      const variant = (edit) => { const data = baseData(); edit(data); return L.parseExperimentInputLink(hrefOf(data)); };
      const refusals = [
        [(d) => { d.extra = 1; }, "BAD_SHAPE"],
        [(d) => { delete d.seed; }, "BAD_SHAPE"],
        [(d) => { d.version = 2; }, "BAD_VERSION"],
        [(d) => { d.version = "1"; }, "BAD_VERSION"],
        [(d) => { d.schema = "draft-link"; }, "BAD_VERSION"],
        [(d) => { d.ruleset = "assumption-manager-v2"; }, "BAD_RULESET"],
        [(d) => { d.patch = ""; }, "BAD_SHAPE"],
        [(d) => { d.patch = "x".repeat(65); }, "BAD_SHAPE"],
        [(d) => { d.seed = -1; }, "BAD_VALUE"],
        [(d) => { d.seed = 4294967296; }, "BAD_VALUE"],
        [(d) => { d.seed = 1.5; }, "BAD_VALUE"],
        [(d) => { d.seed = "7"; }, "BAD_VALUE"],
        [(d) => { d.teams[0].lane = 1.5; }, "BAD_VALUE"],
        [(d) => { d.teams[0].lane = "0.5"; }, "BAD_VALUE"],
        [(d) => { d.teams[1].teamfight = null; }, "BAD_VALUE"],
        [(d) => { d.teams[0].extra = 0; }, "BAD_TEAMS"],
        [(d) => { delete d.teams[0].tempo; }, "BAD_TEAMS"],
        [(d) => { d.teams[1].id = d.teams[0].id; }, "BAD_TEAMS"],
        [(d) => { d.teams.reverse(); }, "BAD_TEAMS"],
        [(d) => { d.teams.push({ ...d.teams[1], id: "zzz" }); }, "BAD_TEAMS"],
        [(d) => { d.teams = { a: d.teams[0], b: d.teams[1] }; }, "BAD_TEAMS"],
        [(d) => { d.teams[0].id = ""; }, "BAD_TEAMS"],
        [(d) => { d.teams[0].id = " " + d.teams[0].id; }, "BAD_TEAMS"],
        [(d) => { d.teams[1].id = "z".repeat(129); }, "BAD_TEAMS"],
      ];
      for (const [edit, reason] of refusals) assert.equal(variant(edit).reason, reason, edit.toString());
      // Own keys only: a JSON "__proto__" key is an extra key.
      const proto = JSON.stringify(baseData()).replace('{"schema"', '{"__proto__":{"x":1},"schema"');
      assert.equal(L.parseExperimentInputLink(hrefOf(proto)).reason, "BAD_SHAPE");
      // Private fields or results are extra keys, never silently dropped.
      assert.equal(variant((d) => { d.roles = {}; }).reason, "BAD_SHAPE");
      assert.equal(variant((d) => { d.teams[0].player_id = "p"; }).reason, "BAD_TEAMS");
    });

    await t.test("parse refuses bad encoding, UTF-8, size, and other hashes", () => {
      const ok = hrefOf(baseData());
      const encoded = new URL(ok).hash.slice(12);
      assert.equal(L.parseExperimentInputLink(`https://example.test/#draft=${encoded}`).reason, "NO_LINK");
      assert.equal(L.parseExperimentInputLink("https://example.test/").reason, "NO_LINK");
      assert.equal(L.parseExperimentInputLink(`https://example.test/#x&experiment=${encoded}`).reason, "NO_LINK");
      assert.equal(L.parseExperimentInputLink("https://example.test/#experiment=").reason, "BAD_ENCODING");
      assert.equal(L.parseExperimentInputLink(`https://example.test/#experiment=${encoded}==`).reason, "BAD_ENCODING");
      assert.equal(L.parseExperimentInputLink(`https://example.test/#experiment=${encoded.replaceAll("-", "+").replaceAll("_", "/")}A+/`).reason, "BAD_ENCODING");
      assert.equal(L.parseExperimentInputLink(`https://example.test/#experiment=A`).reason, "BAD_ENCODING");
      assert.equal(L.parseExperimentInputLink("::").reason, "BAD_URL");
      // Non-canonical base64url: unused low bits of the last character set.
      let text = JSON.stringify(baseData());
      while (Buffer.byteLength(text) % 3 === 0) text += " ";
      const canonical = enc(text);
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
      const loose = canonical.slice(0, -1) + alphabet[alphabet.indexOf(canonical.at(-1)) ^ 1];
      assert.equal(Buffer.from(loose, "base64url").toString("utf8"), text, "same bytes, different text");
      assert.equal(L.parseExperimentInputLink(`https://example.test/#experiment=${canonical}`).ok, true);
      assert.equal(L.parseExperimentInputLink(`https://example.test/#experiment=${loose}`).reason, "BAD_ENCODING");
      // Invalid UTF-8 and non-JSON.
      assert.equal(L.parseExperimentInputLink(`https://example.test/#experiment=${Buffer.from([0x7b, 0xff, 0xfe, 0x7d]).toString("base64url")}`).reason, "BAD_ENCODING");
      assert.equal(L.parseExperimentInputLink(hrefOf("not json")).reason, "BAD_ENCODING");
      // Size: payload bytes and the whole address.
      assert.equal(L.parseExperimentInputLink(hrefOf({ ...baseData(), patch: "x".repeat(1600) })).reason, "TOO_LARGE");
      assert.equal(L.parseExperimentInputLink(`https://example.test/${"a".repeat(L.MAX_EXPERIMENT_LINK_URL)}#experiment=${encoded}`).reason, "TOO_LONG");
    });

    await t.test("tiny finite numbers become plain decimal texts the strict parser accepts, unchanged", () => {
      const values = [Number.MIN_VALUE, -Number.MIN_VALUE, 1e-7, -1.5e-7, Number("1.2345678901234567e-300"), Number("2.2250738585072014e-308"), 0.1, -0.25, 1, -1, 0, -0, 0.000001, 123e-20];
      for (const value of values) {
        const text = L.plainDecimal(value);
        assert.ok(text !== null && !/e/i.test(text), `${value} → ${text}`);
        assert.equal(Number(text), value === 0 ? 0 : value);
        const parsed = E.parseAssumption(text);
        assert.equal(parsed.ok, true, text);
        assert.equal(parsed.value, value === 0 ? 0 : value);
      }
      assert.equal(L.plainDecimal(-0), "0");
      assert.equal(L.plainDecimal(1e-7), "0.0000001");
      assert.equal(L.plainDecimal(Number.MIN_VALUE), `0.${"0".repeat(323)}5`);
      assert.equal(L.plainDecimal(Number.NaN), null);
      assert.equal(L.plainDecimal(Infinity), null);

      // A run made from '.0000001' and Number.MIN_VALUE text: link → plan → same run input.
      const tinyText = L.plainDecimal(Number.MIN_VALUE);
      const run = runOf(snapshot, "4294967295", { [teamA.team_id]: { lane: ".0000001", tempo: "-0", teamfight: ".1000" }, [teamB.team_id]: { lane: tinyText, tempo: "0", teamfight: "-1" } });
      const made = L.createExperimentInputLink(HREF, run, run.endMinute);
      assert.equal(made.ok, true, made.reason);
      const plan = L.planExperimentLinkApply(L.parseExperimentInputLink(made.url).link, snapshot, false);
      assert.equal(plan.ok, true, plan.reason);
      assert.deepEqual(plan.drafts[teamA.team_id], { lane: "0.0000001", tempo: "0", teamfight: "0.1" });
      assert.equal(plan.drafts[teamB.team_id].lane, tinyText);
      assert.equal(plan.seedText, "4294967295");
      const again = runOf(snapshot, plan.seedText, plan.drafts);
      assert.deepEqual(again.input, run.input);
      assert.deepEqual(again.result, run.result);

      // JSON exponent / -0 / trailing zero forms are valid numbers; apply texts stay plain.
      const raw = `{"schema":"experiment-assumptions","version":1,"ruleset":"assumption-manager-v1","patch":${JSON.stringify(snapshot.patch)},"seed":7,` +
        `"teams":[{"id":${JSON.stringify(first)},"lane":1E-7,"tempo":-0,"teamfight":0.1000},{"id":${JSON.stringify(second)},"lane":5e-324,"tempo":0,"teamfight":0}]}`;
      const parsed = L.parseExperimentInputLink(hrefOf(raw));
      assert.equal(parsed.ok, true, parsed.reason);
      assert.ok(Object.is(parsed.link.teams[0].tempo, 0), "-0 normalised to 0");
      const rawPlan = L.planExperimentLinkApply(parsed.link, snapshot, false);
      assert.deepEqual(rawPlan.drafts[first], { lane: "0.0000001", tempo: "0", teamfight: "0.1" });
      assert.equal(rawPlan.drafts[second].lane, tinyText);
    });

    await t.test("existing #draft= links are unaffected and refuse #experiment=", () => {
      const run = runOf(snapshot, "7", structuredClone(drafts));
      const made = L.createExperimentInputLink(HREF, run, run.endMinute);
      assert.throws(() => D.parseDraftShareUrl(made.url, report));
    });

    await t.test("panel SSR: scope text, copy/apply disabled until a completed run / valid incoming link", () => {
      const run = runOf(snapshot, "7", structuredClone(drafts));
      const props = { readyInput: snapshot, blocked: false, onApply: () => { throw new Error("never applied on render"); } };
      const none = renderToStaticMarkup(createElement(ExperimentInputLinkPanel, { ...props, run: null, shownMinute: null }));
      assert.match(none, /<details class="experiment-input-link"><summary>가정값만 공유<\/summary>/, "collapsed by default");
      assert.match(none, /밴픽·선수·역할·분석자료·실험원본은 포함하지 않습니다\. 받은 쪽에서 입력 준비 후 가정값만 적용하고 직접 실행해야 합니다\./);
      assert.match(none, /원본 실험의 증명이 아니며, 전체 실험 재현·근거 공유·실전 승률도 아닙니다/);
      assert.match(none, /<button type="button" disabled=""[^>]*>가정값 링크 복사<\/button>/);
      assert.match(none, /<button type="button" disabled=""[^>]*>가정값 적용<\/button>/);
      assert.match(none, /받은 가정값 링크가 없습니다/);
      assert.doesNotMatch(none, /experiment=|<textarea/);
      const mid = renderToStaticMarkup(createElement(ExperimentInputLinkPanel, { ...props, run, shownMinute: run.endMinute - 1 }));
      assert.match(mid, /<button type="button" disabled=""[^>]*>가정값 링크 복사<\/button>/);
      const done = renderToStaticMarkup(createElement(ExperimentInputLinkPanel, { ...props, run, shownMinute: run.endMinute }));
      assert.match(done, /<button type="button">가정값 링크 복사<\/button>/);
      assert.match(done, /<button type="button" disabled=""[^>]*>가정값 적용<\/button>/, "no incoming link on the server");
    });
  } finally {
    await vite.close();
  }
});
