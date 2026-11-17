import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("draft A/B comparison: legality, teams, evidence identity, isolation and reproducible export", async (t) => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { buildDraftComparisonSnapshot: build, compareDraftSnapshots: compare, serializeDraftComparison, replayDraftComparison,
      replayDraftComparisonFile, evidenceIdentityOf, MAX_DRAFT_COMPARISON_BYTES } = await vite.ssrLoadModule("/app/draft-comparison.ts");
    const { DraftComparisonPanel } = await vite.ssrLoadModule("/app/draft-comparison-panel.tsx");
    const { applyDraftSelection } = await vite.ssrLoadModule("/app/draft-agent.ts");
    const R = await vite.ssrLoadModule("/app/roster-scenario.ts");
    // Shipped public feed: a real RadarReport with opponent_prep teams.
    const liveReport = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
    assert.ok(liveReport.opponent_prep?.teams.length >= 3, "fixture needs at least three teams");
    const [teamA, teamB, teamC] = liveReport.opponent_prep.teams;
    const draft = (side = "BLUE", prefix = "champ") => Array.from({ length: 20 }, (_, i) => i)
      .reduce((all, i) => applyDraftSelection(all, i === 0 && prefix === "champ" ? "Wukong" : `${prefix}${i}`, [], side), []);
    /** Live roster as the roster editor publishes it (here: the observed lineup of the pair). */
    const rosterFor = (report, blue, red) => {
      const teamIds = [blue.team_id, red.team_id].sort();
      const index = R.buildRosterIndex(report.opponent_prep.teams);
      return { basis: R.rosterBasis(report), teamIds, rosters: R.observedRosters(report.opponent_prep.teams, teamIds, index) };
    };
    const input = (overrides = {}) => {
      const value = { report: liveReport, blueTeam: teamA, redTeam: teamB, selections: draft(), games: [], firstPickSide: "BLUE", ...overrides };
      if (!("roster" in overrides)) value.roster = rosterFor(value.report, value.blueTeam ?? teamA, value.redTeam ?? teamB);
      return value;
    };
    const snap = (value) => { const result = build(value); assert.equal(result.ok, true, result.message); return result.snapshot; };

    await t.test("legal complete draft; aliases deduplicate and keep display ids", () => {
      const a = snap(input());
      assert.equal(a.selections[0].champion_id, "MonkeyKing", "asset id (not lowercased) so nameOf can resolve it");
      const alias = input(); alias.selections = alias.selections.map((s, i) => i === 0 ? { ...s, champion_id: "MonkeyKing" } : s);
      assert.equal(compare(a, snap(alias)).unchangedCount, 20);
      const dup = input(); dup.selections = dup.selections.map((s, i) => i === 1 ? { ...s, champion_id: "MonkeyKing" } : s);
      assert.equal(build(dup).ok, false, "Wukong and MonkeyKing are the same champion");
    });

    await t.test("baseline is isolated from later input mutation", () => {
      const value = input(); const a = snap(value);
      value.selections[6].champion_id = "changed";
      value.games.push({ blue_team_id: "x", red_team_id: "y", selections: [] });
      assert.equal(a.selections[6].champion_id, "champ6");
      assert.equal(a.games.length, 0);
      assert.notEqual(a.selections, value.selections);
    });

    await t.test("incomplete, duplicate, metadata, first-pick and malformed selections rejected", () => {
      for (const mutate of [v => v.selections.pop(), v => v.selections.push(v.selections[0]),
        v => v.selections[0].slot = 2, v => v.selections[0].phase = 2, v => v.selections[0].turn = 3,
        v => v.firstPickSide = "RED", v => v.firstPickSide = "PURPLE", v => v.selections[3] = null,
        v => v.selections[3].champion_id = 42, v => v.selections[3].champion_id = "<script>"]) {
        const value = input(); mutate(value); assert.equal(build(value).ok, false, String(mutate));
      }
    });

    await t.test("teams must be two distinct members of the actual report", () => {
      for (const mutate of [v => v.redTeam = null, v => v.redTeam = v.blueTeam, v => v.blueTeam = { ...teamA, team_id: " " },
        v => v.blueTeam = { ...teamA, team_id: "ghost-team" },
        v => v.report = { ...liveReport, opponent_prep: undefined },
        v => v.report = { ...liveReport, opponent_prep: { ...liveReport.opponent_prep, patch_id: "other" } }]) {
        const value = input(); mutate(value); assert.equal(build(value).ok, false, String(mutate));
      }
      const spoofed = snap(input({ blueTeam: { ...teamA, team_name: "Spoofed" } }));
      assert.equal(spoofed.teams.BLUE.name, teamA.team_name, "display name comes from the report record");
    });

    await t.test("pick/ban and team-side diffs use physical side/kind/slot", () => {
      const a = snap(input());
      const value = input(); value.selections = value.selections.map((s, i) => i === 0 ? { ...s, champion_id: "otherban" } : i === 6 ? { ...s, champion_id: "otherpick" } : s);
      [value.blueTeam, value.redTeam] = [teamB, teamA];
      const diff = compare(a, snap(value));
      assert.equal(diff.changes.length, 2); assert.equal(diff.unchangedCount, 18);
      assert.deepEqual(diff.changes.map(c => c.before.kind), ["BAN", "PICK"]);
      assert.deepEqual(diff.teamChanges.map(c => [c.side, c.before.id, c.after.id]), [["BLUE", teamA.team_id, teamB.team_id], ["RED", teamB.team_id, teamA.team_id]]);
      value.blueTeam = teamC;
      assert.equal(build(value).ok, false, "a roster for the previous pair is never reused for a new pair");
      value.roster = rosterFor(liveReport, teamC, teamA);
      const changedPair = compare(a, snap(value));
      assert.equal(changedPair.teamChanges[0].after.id, teamC.team_id);
      assert.equal(changedPair.roster.status, "PAIR_CHANGED");
    });

    await t.test("red-first B compares against blue-first A slot by slot", () => {
      const a = snap(input());
      const redFirst = snap(input({ firstPickSide: "RED", selections: draft("RED") }));
      const diff = compare(a, redFirst);
      assert.equal(diff.firstPickChanged, true);
      assert.equal(diff.changes.length, 20);
      assert.equal(compare(redFirst, snap(input({ firstPickSide: "RED", selections: draft("RED") }))).changes.length, 0);
    });

    await t.test("changed evidence fails closed; an identical copy still compares", () => {
      const a = snap(input());
      assert.equal(compare(a, snap(input({ report: structuredClone(liveReport) }))).ok, true);
      for (const mutate of [r => r.patch_id = "next", r => r.cutoff = "next", r => r.opponent_prep.evidence_index.source_versions.push("next"),
        r => r.entries.push({ ...r.entries[0], rank: 999 }), r => r.opponent_prep.teams[0].game_count += 1]) {
        const report = structuredClone(liveReport); mutate(report);
        if (report.opponent_prep.patch_id !== report.patch_id) report.opponent_prep.patch_id = report.patch_id;
        const result = compare(a, snap(input({ report, blueTeam: report.opponent_prep.teams[0], redTeam: report.opponent_prep.teams[1] })));
        assert.equal(result.ok, false, String(mutate));
      }
      assert.equal(compare(a, { ...a, model: "future-model" }).ok, false);
    });

    await t.test("Fearless lock history: legality, series teams and lock differences", () => {
      const a = snap(input());
      const prior = { blue_team_id: teamB.team_id, red_team_id: teamA.team_id, selections: draft("RED", "old") };
      const b = snap(input({ games: [prior] }));
      assert.equal(compare(a, b).addedLocks.length, 10);
      assert.equal(compare(b, a).removedLocks.length, 10);
      assert.equal(b.games.length, 1);
      const reuse = structuredClone(prior); reuse.selections[6].champion_id = "MonkeyKing";
      assert.equal(build(input({ games: [reuse] })).ok, false, "previous pick locks current bans too, via alias");
      assert.equal(build(input({ games: [{ ...prior, selections: prior.selections.slice(0, 19) }] })).ok, false);
      assert.equal(build(input({ games: [{ ...prior, blue_team_id: teamC.team_id }] })).ok, false);
      assert.equal(build(input({ games: [{ ...prior, selections: [null, ...prior.selections.slice(1)] }] })).ok, false);
      assert.equal(build(input({ games: [prior, structuredClone(prior)] })).ok, false, "reused prior picks rejected");
    });

    await t.test("A/B export replays to the same result and rejects tampering", () => {
      const a = snap(input());
      const bInput = input({ firstPickSide: "RED", selections: draft("RED", "next"), games: [] });
      const b = snap(bInput);
      const exported = serializeDraftComparison(liveReport, a, b);
      assert.equal(exported.ok, true, exported.message);
      const parsed = JSON.parse(exported.text);
      assert.deepEqual(Object.keys(parsed).sort(), ["analysis_snapshot", "baseline_a", "boundary", "comparison", "current_b", "cutoff",
        "evidence", "format", "model_version", "patch_id", "schema_version", "artifact_type"].sort(), "no staged/private session fields");
      assert.equal(parsed.patch_id, liveReport.patch_id); assert.equal(parsed.cutoff, liveReport.cutoff);
      assert.equal(parsed.model_version, "fearless-preview-v2");
      // The shared public analysis snapshot is reused as-is; the comparison-specific fields add no prediction.
      const comparisonFields = { ...parsed }; delete comparisonFields.analysis_snapshot; delete comparisonFields.boundary;
      const { boundary } = parsed;
      assert.match(boundary, /no win probability/i);
      assert.doesNotMatch(JSON.stringify(comparisonFields), /staged_champion|win_rate|probability|synergy_score|counter_score/);
      const replay = replayDraftComparison(exported.text);
      assert.equal(replay.ok, true, replay.message);
      assert.equal(replay.comparison.changes.length, compare(a, b).changes.length);
      assert.equal(serializeDraftComparison(liveReport, replay.a, replay.b).text, exported.text, "byte-identical re-export");
      const tamper = (fn) => { const copy = structuredClone(parsed); fn(copy); return replayDraftComparison(JSON.stringify(copy)).ok; };
      assert.equal(tamper(c => c.comparison.unchanged_count += 1), false);
      assert.equal(tamper(c => c.current_b.selections[5].champion_id = c.current_b.selections[4].champion_id), false);
      assert.equal(tamper(c => c.baseline_a.blue_team.team_id = "ghost-team"), false);
      assert.equal(tamper(c => c.analysis_snapshot.patch_id = "other"), false);
      assert.equal(tamper(c => c.model_version = "future-model"), false);
      assert.equal(tamper(c => c.evidence.source_versions = []), false, "outer source metadata must match the embedded snapshot");
      assert.equal(tamper(c => { delete c.evidence; }), false, "missing provenance metadata is rejected");
      assert.equal(tamper(c => c.evidence.source_versions[0].content_hash = "modified"), false, "conflicting source hashes are rejected");
      assert.equal(tamper(c => c.artifact_type = "public-draft-scenario"), false);
      assert.equal(replayDraftComparison("{not json").ok, false);
      assert.equal(serializeDraftComparison(structuredClone(liveReport), a, b).ok, true, "same evidence by value is accepted");
      const changed = structuredClone(liveReport); changed.cutoff = "other";
      assert.equal(serializeDraftComparison(changed, a, b).ok, false, "export refuses a report that differs from A");
      const huge = structuredClone(liveReport); huge.padding = "x".repeat(MAX_DRAFT_COMPARISON_BYTES);
      const hugeA = snap(input({ report: huge, blueTeam: huge.opponent_prep.teams[0], redTeam: huge.opponent_prep.teams[1] }));
      const bounded = serializeDraftComparison(huge, hugeA, hugeA);
      assert.equal(bounded.ok, false, "export size is bounded");
      assert.equal(replayDraftComparison(" ".repeat(MAX_DRAFT_COMPARISON_BYTES + 1)).ok, false);
    });

    await t.test("panel renders Korean, memory-only lifetime and no win-rate claim", () => {
      const nameOf = (id) => id === "MonkeyKing" ? "오공" : id;
      const complete = renderToStaticMarkup(createElement(DraftComparisonPanel, { ...input(), nameOf }));
      assert.match(complete, /lang="ko"/);
      assert.match(complete, /메모리에만/);
      assert.match(complete, /<button type="button">현재 완료 드래프트를 기준 A로 고정<\/button>/, "complete legal draft can be frozen");
      assert.match(complete, /<button type="button" disabled="">A\/B 비교 JSON 저장<\/button>/);
      assert.doesNotMatch(complete, /\d+(\.\d+)?%/);
      const partial = renderToStaticMarkup(createElement(DraftComparisonPanel, { ...input({ selections: draft().slice(0, 7) }), nameOf }));
      assert.match(partial, /<button type="button" disabled="">현재 완료 드래프트를 기준 A로 고정<\/button>/);
      assert.match(partial, /현재 7\/20개/);
    });

    await t.test("comparison file replay: size limit, read failure, bad input, tampering, other evidence", async () => {
      const a = snap(input());
      const b = snap(input({ selections: draft("BLUE", "next") }));
      const exported = serializeDraftComparison(liveReport, a, b);
      const file = (text) => ({ size: new TextEncoder().encode(text).byteLength, text: async () => text });
      const fromFile = await replayDraftComparisonFile(file(exported.text));
      assert.equal(fromFile.ok, true, fromFile.message);
      assert.deepEqual(fromFile.comparison, compare(a, b), "export → file import shows the same comparison");
      assert.deepEqual([fromFile.a, fromFile.b], [a, b]);
      assert.equal(fromFile.a.evidenceIdentity, evidenceIdentityOf(liveReport), "same evidence is recognisable");

      let read = false;
      const oversize = await replayDraftComparisonFile({ size: MAX_DRAFT_COMPARISON_BYTES + 1, text: async () => { read = true; return exported.text; } });
      assert.equal(oversize.ok, false); assert.match(oversize.message, /16MB/);
      assert.equal(read, false, "oversize files are rejected before reading contents");
      assert.equal((await replayDraftComparisonFile({ size: Number.NaN, text: async () => exported.text })).ok, false);
      const unreadable = await replayDraftComparisonFile({ size: 10, text: async () => { throw new Error("NotReadableError"); } });
      assert.equal(unreadable.ok, false); assert.match(unreadable.message, /읽지 못했습니다/);
      for (const text of ["{not json", "null", "[]", "42", "\"text\"", "{}"]) {
        const result = await replayDraftComparisonFile(file(text));
        assert.equal(result.ok, false, text); assert.equal(typeof result.message, "string");
      }
      const parsed = JSON.parse(exported.text);
      for (const mutate of [c => c.baseline_a = null, c => c.current_b.selections = "x", c => c.current_b.selections = [null],
        c => c.baseline_a.previous_games = { length: 1 }, c => c.baseline_a.previous_games = [null], c => c.current_b.first_pick_side = 7,
        c => c.analysis_snapshot = null, c => c.analysis_snapshot.opponent_prep = null, c => c.comparison = null,
        c => c.comparison.changes.pop(), c => c.comparison.added_locks = ["Ahri"]]) {
        const copy = structuredClone(parsed); mutate(copy);
        const result = await replayDraftComparisonFile(file(JSON.stringify(copy)));
        assert.equal(result.ok, false, String(mutate));
      }

      // A file made from different (but internally consistent) evidence replays on its own data only.
      const other = structuredClone(liveReport); other.cutoff = "2099-01-01T00:00:00Z";
      const [otherBlue, otherRed] = other.opponent_prep.teams;
      const oa = snap(input({ report: other, blueTeam: otherBlue, redTeam: otherRed }));
      const otherFile = serializeDraftComparison(other, oa, oa);
      const replayedOther = await replayDraftComparisonFile(file(otherFile.text));
      assert.equal(replayedOther.ok, true, replayedOther.message);
      assert.notEqual(replayedOther.a.evidenceIdentity, evidenceIdentityOf(liveReport), "panel can flag different evidence");
      assert.equal(compare(a, replayedOther.a).ok, false, "never mixed with the current studio evidence");
    });

    // ---- Virtual rosters (schema v2) ------------------------------------------------------
    const index = R.buildRosterIndex(liveReport.opponent_prep.teams);
    const foreignPlayer = [...index.players.values()].find((p) => p.source_team_id !== teamA.team_id && p.source_team_id !== teamB.team_id);
    const withRoster = (live, mutate) => { const copy = structuredClone(live); mutate(copy.rosters); return copy; };

    await t.test("roster: frozen A is detached; identical picks still surface roster slot changes by team and role", () => {
      assert.ok(foreignPlayer, "feed needs a player from a third team");
      const live = rosterFor(liveReport, teamA, teamB);
      const before = JSON.stringify(liveReport.opponent_prep.teams);
      const a = snap(input({ roster: live }));
      // Later edits of the live roster object must not reach the frozen capture.
      live.rosters[teamA.team_id].SUPPORT = { source_team_id: foreignPlayer.source_team_id, player_id: foreignPlayer.player_id };
      live.rosters[teamB.team_id].TOP = null;
      assert.notEqual(a.roster.teams[teamA.team_id].SUPPORT?.player_id, foreignPlayer.player_id, "A keeps the roster at freeze time");
      const b = snap(input({ roster: live }));
      const diff = compare(a, b);
      assert.equal(diff.unchangedCount, 20, "picks/bans identical");
      assert.equal(diff.roster.status, "COMPARED");
      assert.deepEqual(diff.roster.changes.map((c) => [c.team_id, c.role]).sort(), [[teamA.team_id, "SUPPORT"], [teamB.team_id, "TOP"]].sort());
      const support = diff.roster.changes.find((c) => c.role === "SUPPORT");
      assert.equal(support.b.player_id, foreignPlayer.player_id);
      assert.equal(support.b.player_name, foreignPlayer.player_name, "label from the report record");
      assert.equal(JSON.stringify(liveReport.opponent_prep.teams), before, "source data is not mutated");
      assert.equal(compare(a, a).roster.changes.length, 0);
    });

    await t.test("roster: side swap keeps meaning by team ID", () => {
      const live = rosterFor(liveReport, teamA, teamB);
      const a = snap(input({ roster: live }));
      const edited = withRoster(live, (r) => { r[teamA.team_id].SUPPORT = { source_team_id: foreignPlayer.source_team_id, player_id: foreignPlayer.player_id }; });
      const swapped = snap(input({ blueTeam: teamB, redTeam: teamA, roster: edited }));
      const diff = compare(a, swapped);
      assert.equal(diff.teamChanges.length, 2);
      assert.deepEqual(diff.roster.changes.map((c) => [c.team_id, c.role]), [[teamA.team_id, "SUPPORT"]], "only the edited slot, not every slot of both sides");
      assert.equal(compare(a, snap(input({ blueTeam: teamB, redTeam: teamA, roster: live }))).roster.changes.length, 0, "swap alone is not a roster change");
    });

    await t.test("roster: unknown, ambiguous, duplicate, wrong-pair and wrong-basis rosters rejected; empty slots allowed", () => {
      const live = rosterFor(liveReport, teamA, teamB);
      const fails = (roster) => build(input({ roster })).ok === false;
      assert.ok(fails(withRoster(live, (r) => { r[teamA.team_id].MID = { source_team_id: teamA.team_id, player_id: "ghost-id" }; })));
      const placed = Object.values(live.rosters[teamA.team_id]).find(Boolean);
      assert.ok(placed, "observed lineup has at least one placed player");
      const otherRole = R.ROSTER_ROLES.find((role) => live.rosters[teamB.team_id][role]?.player_id !== placed.player_id);
      assert.ok(fails(withRoster(live, (r) => { r[teamB.team_id][otherRole] = { ...placed }; })), "duplicate player");
      assert.ok(fails({ ...live, rosters: { [teamA.team_id]: live.rosters[teamA.team_id], [teamC.team_id]: R.emptySlots() } }), "other pair");
      assert.ok(fails({ ...live, basis: { ...live.basis, cutoff: "other" } }), "other basis");
      assert.ok(fails({ ...live, rosters: null }));
      const empty = snap(input({ roster: { ...live, rosters: { [teamA.team_id]: R.emptySlots(), [teamB.team_id]: R.emptySlots() } } }));
      assert.equal(Object.values(empty.roster.teams[teamA.team_id]).every((slot) => slot === null), true);
    });

    await t.test("roster: v2 export replays byte-identically and detects roster tampering", () => {
      const live = rosterFor(liveReport, teamA, teamB);
      const a = snap(input({ roster: live }));
      const b = snap(input({ blueTeam: teamB, redTeam: teamA, roster: withRoster(live, (r) => {
        r[teamB.team_id].SUPPORT = { source_team_id: foreignPlayer.source_team_id, player_id: foreignPlayer.player_id };
      }) }));
      const exported = serializeDraftComparison(liveReport, a, b);
      assert.equal(exported.ok, true, exported.message);
      const parsed = JSON.parse(exported.text);
      assert.equal(parsed.schema_version, "3", "current exports are v3 (roster + explicit role record or null)");
      assert.equal(parsed.baseline_a.champion_roles, null, "no roles assigned: explicit null, never inferred");
      assert.deepEqual(parsed.comparison.roles, { status: "NOT_RECORDED", missing: ["A", "B"] });
      assert.equal(parsed.baseline_a.roster.evidence_scope, "CURRENT_REPORT_PLAYER_OBSERVATIONS");
      assert.deepEqual(Object.keys(parsed.current_b.roster.rosters), [teamA.team_id, teamB.team_id].sort(), "keyed by team ID");
      assert.match(parsed.boundary, /No win probability, player effect/);
      assert.match(parsed.boundary, /no season-history file/);
      assert.equal(parsed.comparison.roster.status, "COMPARED");
      assert.ok(parsed.comparison.roster.changes.some((c) => c.team_id === teamB.team_id && c.role === "SUPPORT"));
      const replay = replayDraftComparison(exported.text);
      assert.equal(replay.ok, true, replay.message);
      assert.equal(replay.schema, "3");
      assert.equal(serializeDraftComparison(liveReport, replay.a, replay.b).text, exported.text, "byte-identical re-export");
      const tamper = (fn) => { const copy = structuredClone(parsed); fn(copy); return replayDraftComparison(JSON.stringify(copy)); };
      const sup = (c) => c.current_b.roster.rosters[teamB.team_id].SUPPORT;
      for (const [label, fn] of [
        ["ghost id", (c) => { sup(c).player_id = "ghost-id"; }],
        ["renamed label", (c) => { sup(c).player_name = "Someone"; }],
        ["swapped source team", (c) => { sup(c).source_team_id = teamA.team_id; }],
        ["recorded diff", (c) => { c.comparison.roster.changes = []; }],
        ["recorded status", (c) => { c.comparison.roster = { status: "NOT_RECORDED" }; }],
        ["missing roster", (c) => { delete c.baseline_a.roster; }],
        ["scope", (c) => { c.current_b.roster.evidence_scope = "SEASON_HISTORY"; }],
        ["basis", (c) => { c.baseline_a.roster.basis.patch_id = "0.0"; }],
        ["duplicate", (c) => { c.current_b.roster.rosters[teamA.team_id].SUPPORT = structuredClone(sup(c)); }],
        ["unknown schema", (c) => { c.schema_version = "4"; }],
        ["missing role record", (c) => { delete c.current_b.champion_roles; }],
      ]) assert.equal(tamper(fn).ok, false, label);
      const emptyA = snap(input({ roster: { ...live, rosters: { [teamA.team_id]: R.emptySlots(), [teamB.team_id]: R.emptySlots() } } }));
      assert.equal(replayDraftComparison(serializeDraftComparison(liveReport, emptyA, b).text).ok, true, "empty slots replay");
      assert.equal(serializeDraftComparison(liveReport, snap(input({ roster: null })), b).ok, false, "v2 export requires both rosters");
    });

    await t.test("roster: legacy v1 file replays read-only with roster NOT_RECORDED (never filled from current)", () => {
      const a = snap(input()); const b = snap(input({ selections: draft("BLUE", "next") }));
      const v2 = JSON.parse(serializeDraftComparison(liveReport, a, b).text);
      const v1 = structuredClone(v2);
      v1.schema_version = "1";
      delete v1.baseline_a.roster; delete v1.current_b.roster; delete v1.comparison.roster;
      delete v1.baseline_a.champion_roles; delete v1.current_b.champion_roles; delete v1.comparison.roles;
      const replay = replayDraftComparison(JSON.stringify(v1));
      assert.equal(replay.ok, true, replay.message);
      assert.equal(replay.schema, "1");
      assert.equal(replay.a.roster, null); assert.equal(replay.b.roster, null);
      assert.equal(replay.comparison.roster.status, "NOT_RECORDED");
      const smuggled = structuredClone(v1); smuggled.comparison.roster = v2.comparison.roster;
      assert.equal(replayDraftComparison(JSON.stringify(smuggled)).ok, false, "v1 record must match the v1 recomputation");
      const markup = renderToStaticMarkup(createElement(DraftComparisonPanel, { ...input({ roster: null }), nameOf: (id) => id }));
      assert.match(markup, /가상 로스터를 확인하는 중/, "no live roster: nothing is frozen from defaults");
      assert.match(markup, /<button type="button" disabled="">현재 완료 드래프트를 기준 A로 고정<\/button>/);
      assert.match(markup, /이미 고정된 기준 A는 소급 변경되지 않습니다/);
      assert.match(markup, /시즌 전체 선수 기록은 포함하지 않습니다/);
      assert.match(markup, /선수 효과·승률·시너지·카운터 평가나 경기 시뮬레이션은 계산하지 않습니다/);
    });

    // ---- Explicit user roles (schema v3) ---------------------------------------------------
    const { compareRoles, draftRosterKey } = await vite.ssrLoadModule("/app/draft-comparison.ts");
    const { teamPicks } = await vite.ssrLoadModule("/app/champion-roles.ts");
    /** Roles in the order of each team's own pick slots (test convenience only; the product never infers this). */
    const rolesFor = (value, rotate = {}) => {
      const result = {};
      for (const [side, team] of [["BLUE", value.blueTeam], ["RED", value.redTeam]]) {
        const picks = teamPicks(value.selections, side);
        const shift = rotate[team.team_id] ?? 0;
        result[team.team_id] = Object.fromEntries(R.ROSTER_ROLES.map((role, i) => [role, picks[(i + shift) % 5]]));
      }
      return result;
    };

    await t.test("roles: validated, detached copy; later edits of the source never reach a frozen A", () => {
      const value = input(); value.roles = rolesFor(value);
      const a = snap(value);
      assert.deepEqual(a.roles, rolesFor(input()));
      value.roles[teamA.team_id].TOP = "edited";
      assert.notEqual(a.roles[teamA.team_id].TOP, "edited", "A keeps roles at freeze time");
      assert.equal(snap(input()).roles, null, "no roles given → explicit null (never inferred from slots)");
      assert.equal(draftRosterKey(a), draftRosterKey(snap(input())), "draft/roster key ignores roles");
      assert.notEqual(draftRosterKey(a), draftRosterKey(snap(input({ selections: draft("BLUE", "next") }))));
    });

    await t.test("roles: bad shape, other-team pick, duplicate, missing role and alias", () => {
      const fails = (mutate) => { const value = input(); value.roles = rolesFor(value); mutate(value.roles, value); const result = build(value); return result.ok === false && /역할 배정/.test(result.message); };
      assert.ok(fails((r) => { r[teamA.team_id].TOP = null; }), "unassigned role");
      assert.ok(fails((r) => { r[teamA.team_id].TOP = r[teamB.team_id].TOP; }), "other team's pick");
      assert.ok(fails((r) => { r[teamA.team_id].MID = r[teamA.team_id].TOP; }), "duplicate champion");
      assert.ok(fails((r) => { delete r[teamA.team_id].SUPPORT; }), "missing role key");
      assert.ok(fails((r) => { r[teamC.team_id] = r[teamA.team_id]; delete r[teamA.team_id]; }), "other team id");
      assert.ok(fails((r) => { r[teamA.team_id].TOP = "<script>"; }));
      // Ban ids are not picks: the first BLUE selection ("Wukong") is a ban in this fixture.
      const value = input(); value.roles = rolesFor(value);
      const banId = value.selections.find((s) => s.kind === "BAN").champion_id;
      value.roles[teamA.team_id].TOP = banId;
      assert.equal(build(value).ok, false, "a ban is never a role champion");
    });

    await t.test("roles: compare by team ID; side swap alone is no role change; role swap within a team is", () => {
      const value = input(); value.roles = rolesFor(value);
      const a = snap(value);
      const same = snap({ ...input(), roles: rolesFor(input()) });
      assert.deepEqual(compare(a, same).roles, { status: "COMPARED", changes: [] });
      const rotated = input(); rotated.roles = rolesFor(rotated, { [teamA.team_id]: 1 });
      const diff = compare(a, snap(rotated)).roles;
      assert.equal(diff.status, "COMPARED");
      assert.equal(diff.changes.length, 5);
      assert.ok(diff.changes.every((c) => c.team_id === teamA.team_id));
      assert.deepEqual(compare(a, snap(input())).roles, { status: "NOT_RECORDED", missing: ["B"] });
      assert.deepEqual(compareRoles(null, a.roles), { status: "NOT_RECORDED", missing: ["A"] });
      // Swapped sides with the same per-team champions (picks move with the team).
      const blue = teamPicks(value.selections, "BLUE"), red = teamPicks(value.selections, "RED");
      const swappedSel = value.selections.map((s) => {
        if (s.kind !== "PICK") return s;
        const list = s.side === "BLUE" ? red : blue;
        const own = s.side === "BLUE" ? blue : red;
        return { ...s, champion_id: list[own.indexOf(s.champion_id)] ?? s.champion_id };
      });
      const swapped = input({ blueTeam: teamB, redTeam: teamA, selections: swappedSel });
      swapped.roles = { [teamA.team_id]: a.roles[teamA.team_id], [teamB.team_id]: a.roles[teamB.team_id] };
      const swappedSnap = build(swapped);
      assert.equal(swappedSnap.ok, true, swappedSnap.message);
      assert.deepEqual(compare(a, swappedSnap.snapshot).roles.changes, [], "side swap keeps role meaning by team ID");
      const otherPair = input({ blueTeam: teamC, roster: rosterFor(liveReport, teamC, teamB) }); otherPair.roles = rolesFor(otherPair);
      assert.equal(compare(a, snap(otherPair)).roles.status, "PAIR_CHANGED");
    });

    await t.test("roles: v3 export replays byte-identically; role tampering and v1/v2 role smuggling rejected", () => {
      const aIn = input(); aIn.roles = rolesFor(aIn);
      const bIn = input(); bIn.roles = rolesFor(bIn, { [teamB.team_id]: 2 });
      const a = snap(aIn), b = snap(bIn);
      const exported = serializeDraftComparison(liveReport, a, b);
      assert.equal(exported.ok, true, exported.message);
      const parsed = JSON.parse(exported.text);
      assert.equal(parsed.schema_version, "3");
      assert.deepEqual(Object.keys(parsed.baseline_a.champion_roles), [teamA.team_id, teamB.team_id].sort());
      assert.equal(parsed.comparison.roles.status, "COMPARED");
      assert.equal(parsed.comparison.roles.changes.length, 5);
      assert.match(parsed.boundary, /NOT included in or reproduced by this file/);
      assert.doesNotMatch(exported.text, /player-season|season_accepted_game_count|recent_game_limit/, "no annual data in the file");
      const replay = replayDraftComparison(exported.text);
      assert.equal(replay.ok, true, replay.message);
      assert.deepEqual(replay.a.roles, a.roles);
      assert.equal(serializeDraftComparison(liveReport, replay.a, replay.b).text, exported.text, "byte-identical re-export");
      const tamper = (fn) => { const copy = structuredClone(parsed); fn(copy); return replayDraftComparison(JSON.stringify(copy)).ok; };
      const ta = teamA.team_id, tb = teamB.team_id;
      assert.equal(tamper((c) => { c.current_b.champion_roles[tb].TOP = c.current_b.champion_roles[ta].TOP; }), false, "other team's pick");
      assert.equal(tamper((c) => { c.current_b.champion_roles[tb].MID = c.current_b.champion_roles[tb].TOP; }), false, "duplicate");
      assert.equal(tamper((c) => { c.current_b.champion_roles[tb].TOP = null; }), false, "unassigned");
      assert.equal(tamper((c) => { c.current_b.champion_roles = "x"; }), false, "shape");
      assert.equal(tamper((c) => { c.comparison.roles.changes.pop(); }), false, "recorded role diff must match");
      assert.equal(tamper((c) => { c.comparison.roles = { status: "NOT_RECORDED", missing: ["A", "B"] }; }), false);
      assert.equal(tamper((c) => { c.current_b.champion_roles = null; }), false, "null roles change the recorded comparison");
      assert.equal(tamper((c) => { c.current_b.champion_roles = null; c.comparison.roles = { status: "NOT_RECORDED", missing: ["B"] }; }), true, "explicit null is valid when recorded consistently");
      // v2: roster but no roles; read-only; any role field is rejected, never used.
      const v2 = structuredClone(parsed); v2.schema_version = "2";
      delete v2.baseline_a.champion_roles; delete v2.current_b.champion_roles; delete v2.comparison.roles;
      const v2Replay = replayDraftComparison(JSON.stringify(v2));
      assert.equal(v2Replay.ok, true, v2Replay.message);
      assert.equal(v2Replay.schema, "2");
      assert.equal(v2Replay.a.roles, null); assert.equal(v2Replay.b.roles, null);
      assert.equal(v2Replay.comparison.roles.status, "NOT_RECORDED", "never filled from current roles");
      const smuggled = structuredClone(v2); smuggled.baseline_a.champion_roles = parsed.baseline_a.champion_roles;
      assert.equal(replayDraftComparison(JSON.stringify(smuggled)).ok, false, "role field in v2 rejected");
      const smuggledRecord = structuredClone(v2); smuggledRecord.comparison.roles = parsed.comparison.roles;
      assert.equal(replayDraftComparison(JSON.stringify(smuggledRecord)).ok, false, "v2 record must match the v2 recomputation");
    });

    await t.test("roles: panel shows role state and keeps the annual reference out of the file", () => {
      const markup = renderToStaticMarkup(createElement(DraftComparisonPanel, { ...input(), nameOf: (id) => id }));
      assert.match(markup, /역할 배정 기록 없음/, "B without a ready input has no role record");
      assert.match(markup, /비교 JSON에 포함되지 않습니다/);
      assert.doesNotMatch(markup, /유리|승리|숙련도|강함/);
    });

    await t.test("panel replay section is read-only, Korean and isolated from baseline/draft/autosave", async () => {
      const markup = renderToStaticMarkup(createElement(DraftComparisonPanel, { ...input(), nameOf: (id) => id }));
      assert.match(markup, /<h3 id="draft-comparison-replay-title">저장한 비교 파일 재현<\/h3>/);
      assert.match(markup, /<input type="file" accept="application\/json,.json"\/>/);
      assert.match(markup, /<button type="button" disabled="">재현 결과 닫기<\/button>/, "reset disabled until something was opened");
      assert.match(markup, /읽기 전용/);
      // Static evidence only (no DOM runtime here): the replay path cannot touch baseline A or studio state.
      const source = await readFile(new URL("../app/draft-comparison-panel.tsx", import.meta.url), "utf8");
      const handler = source.match(/async function openReplay[\s\S]*?\r?\n {2}\}\r?\n/)?.[0];
      assert.ok(handler, "replay handler found");
      assert.doesNotMatch(handler, /setBaseline|writeLocalDraft|onChange\(|selections|roster|localStorage/i, "replay never replaces baseline A, the draft or the roster");
      assert.doesNotMatch(source, /localStorage|onRosterChange|roster-workshop/, "panel cannot write the roster or its device copy");
      assert.match(handler, /readingRef\.current\) \{ input\.value = ""; return; \}/, "duplicate submission ignored");
      assert.match(handler, /finally \{[\s\S]*input\.value = "";/, "input is reset after every attempt");
      assert.doesNotMatch(source, /draft-session|use-draft-save|draft-autosave/, "panel has no access to autosave");
    });
  } finally { await vite.close(); }
});
