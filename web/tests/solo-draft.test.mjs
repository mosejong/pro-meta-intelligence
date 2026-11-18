import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { before, after, test } from "node:test";
import { createServer } from "vite";

let vite, suggest, agent, report, ids, base;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  ({ suggestSoloDraftTurn: suggest } = await vite.ssrLoadModule("/app/solo-draft.ts"));
  agent = await vite.ssrLoadModule("/app/draft-agent.ts");
  const { SHARE_CHAMPIONS } = await vite.ssrLoadModule("/app/share-champion-ids.ts");
  ids = SHARE_CHAMPIONS.map(([, id]) => id);
  report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
  base = { report, blueTeam: report.opponent_prep.teams[0], redTeam: report.opponent_prep.teams[1],
    selections: [], previousPicks: [], firstPickSide: "BLUE", manualSide: "RED" };
});
after(async () => { await vite?.close(); });

function play(input) {
  let selections = [];
  for (let step = 0; step < 20; step++) {
    const state = { ...input, selections };
    const before = structuredClone(state);
    const turn = agent.nextDraftTurn(selections, input.firstPickSide);
    const result = suggest(state);
    assert.deepEqual(state, before);
    assert.deepEqual(suggest(state), result);
    let id;
    if (turn.side === input.manualSide) {
      assert.equal(result, null);
      id = ids.find(id => agent.applyDraftSelection(selections, id, input.previousPicks, input.firstPickSide) !== selections);
    } else {
      assert.ok(result, `opponent step ${step + 1}`);
      assert.ok(ids.includes(result.champion_id));
      assert.ok(result.reason.length);
      assert.ok(["TEAM_RECORD", "RADAR", "FALLBACK"].includes(result.source));
      id = result.champion_id;
    }
    const next = agent.applyDraftSelection(selections, id, input.previousPicks, input.firstPickSide);
    assert.equal(next.length, step + 1);
    selections = next;
  }
  assert.equal(suggest({ ...input, selections }), null);
  return selections;
}

test("real feed: all twenty turns, both manual sides, both first sides, Fearless locks", () => {
  for (const manualSide of ["BLUE", "RED"]) for (const firstPickSide of ["BLUE", "RED"]) {
    const first = play({ ...base, manualSide, firstPickSide });
    const previousPicks = first.filter(s => s.kind === "PICK").map(s => s.champion_id);
    previousPicks.push("Vel'Koz");
    const next = play({ ...base, manualSide, firstPickSide, previousPicks });
    assert.ok(next.every(s => !previousPicks.includes(s.champion_id) && s.champion_id !== "Velkoz"));
  }
});

const tendency = (champion_id, role, game_rate = 0.8) => ({ champion_id, role, game_rate, game_count: 4,
  phase_1_count: 4, phase_2_count: 0, evidence_event_ids: [] });
function fixture(blue = [], red = [], entries = []) {
  return { ...base, report: { ...report, entries }, blueTeam: { ...base.blueTeam, priority_picks: blue, player_profiles: [] },
    redTeam: { ...base.redTeam, priority_picks: red, player_profiles: [] } };
}
function prefix(count, first = "BLUE") {
  let selections = [];
  for (const id of ids.filter(id => !["Ahri", "Akali", "Ashe", "Velkoz"].includes(id)).slice(0, count)) {
    selections = agent.applyDraftSelection(selections, id, [], first);
  }
  return selections;
}

test("bans target opposing priorities; picks target acting priorities; canonical Velkoz locks", () => {
  const input = fixture([tendency("Ahri", "MID")], [tendency("VelKoz", "MID")]);
  assert.equal(suggest(input).champion_id, "Velkoz");
  assert.equal(suggest(input).source, "TEAM_RECORD");
  assert.notEqual(suggest({ ...input, previousPicks: ["Vel'Koz"] }).champion_id, "Velkoz");
  assert.equal(suggest({ ...input, selections: prefix(6) }).champion_id, "Ahri");
});

test("strict observed role duplication yields to another priority; flexible and unknown hints stay available", () => {
  const selections = prefix(6);
  selections.push(...agent.applyDraftSelection(selections, "Ahri").slice(6));
  let current = agent.applyDraftSelection(selections, "Ashe");
  current = agent.applyDraftSelection(current, "Velkoz");
  const input = fixture([tendency("Ahri", "MID"), tendency("Akali", "MID"), tendency("Zyra", "SUPPORT", 0.2)]);
  assert.equal(suggest({ ...input, selections: current }).champion_id, "Zyra");
  input.blueTeam.priority_picks.push(tendency("Akali", "TOP"));
  assert.equal(suggest({ ...input, selections: current }).champion_id, "Akali");
  input.blueTeam.priority_picks = [tendency("Ahri", "MID"), tendency("Akali", undefined)];
  assert.equal(suggest({ ...input, selections: current }).champion_id, "Akali");
});

test("empty frames and ineligible radar use pinned fallback through a complete draft", () => {
  const input = fixture();
  assert.equal(suggest(input).source, "FALLBACK");
  play({ ...input, previousPicks: ["Aatrox", "VelKoz", "Ahri"] });
  const entry = { ...report.entries[0], champion_id: "VelKoz", rank: 1, eligible_for_review: true };
  assert.deepEqual(suggest(fixture([], [], [entry])), {
    champion_id: "Velkoz", source: "RADAR", reason: "공개 레이더의 검토 가능 후보를 사용한 연습 선택입니다.",
  });
  assert.equal(suggest(fixture([], [], [{ ...entry, eligible_for_review: false }])).source, "FALLBACK");
  assert.equal(suggest(fixture([tendency("UnknownChampion", "MID")], [tendency("UnknownChampion", "MID")])).source, "FALLBACK");
});

test("invalid history refuses to guess, missing/same teams and own turns return null", () => {
  for (const patch of [{ blueTeam: null }, { redTeam: null }, { redTeam: base.blueTeam },
    { manualSide: "BLUE" }, { manualSide: "BAD" }, { firstPickSide: "BAD" },
    { previousPicks: ["UnknownChampion"] }]) assert.equal(suggest({ ...base, ...patch }), null);
  const valid = prefix(3);
  for (const change of [s => s[0].turn++, s => s[0].side = "RED", s => s[0].kind = "PICK",
    s => s[0].phase = 2, s => s[0].slot = 3, s => s[0].champion_id = "UnknownChampion",
    s => s[1].champion_id = s[0].champion_id, s => s.reverse()]) {
    const selections = structuredClone(valid); change(selections);
    assert.equal(suggest({ ...base, selections }), null);
  }
  assert.equal(suggest({ ...base, selections: valid, previousPicks: [valid[0].champion_id] }), null);
  assert.equal(suggest({ ...base, selections: valid, firstPickSide: "RED" }), null);
});

test("priority ties are stable under input reordering and frozen inputs are untouched", () => {
  const input = fixture([], [tendency("Zyra", "SUPPORT"), tendency("Ahri", "MID")]);
  const expected = suggest(input);
  input.redTeam.priority_picks.reverse();
  const freeze = value => { if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  } };
  freeze(input);
  assert.deepEqual(suggest(input), expected);
});


test("eligible current meta precedes season/team fallback, and locked meta yields safely", () => {
  const input = fixture([tendency("Akali", "MID")], [], [{ ...report.entries[0], champion_id: "Zyra", role: "SUPPORT", rank: 1, eligible_for_review: true }]);
  const selections = prefix(6);
  const choice = suggest({ ...input, selections });
  assert.equal(choice.champion_id, "Zyra"); assert.equal(choice.source, "RADAR"); assert.equal(choice.role_supported, true);
  const locked = suggest({ ...input, selections, previousPicks: ["Zyra"] });
  assert.equal(locked.champion_id, "Akali"); assert.equal(locked.role_supported, true);
  const sparse = suggest({ ...fixture(), selections });
  assert.equal(sparse.role_supported, false); assert.match(sparse.reason, /포지션 근거가 부족/);
});
