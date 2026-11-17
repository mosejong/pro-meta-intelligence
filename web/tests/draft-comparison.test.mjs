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
    // Shipped public feed: a real RadarReport with opponent_prep teams.
    const liveReport = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
    assert.ok(liveReport.opponent_prep?.teams.length >= 3, "fixture needs at least three teams");
    const [teamA, teamB, teamC] = liveReport.opponent_prep.teams;
    const draft = (side = "BLUE", prefix = "champ") => Array.from({ length: 20 }, (_, i) => i)
      .reduce((all, i) => applyDraftSelection(all, i === 0 && prefix === "champ" ? "Wukong" : `${prefix}${i}`, [], side), []);
    const input = (overrides = {}) => ({ report: liveReport, blueTeam: teamA, redTeam: teamB, selections: draft(), games: [], firstPickSide: "BLUE", ...overrides });
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
      assert.equal(compare(a, snap(value)).teamChanges[0].after.id, teamC.team_id);
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
      assert.match(boundary, /no win probability/);
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
      assert.doesNotMatch(handler, /setBaseline|writeLocalDraft|onChange\(|selections/, "replay never replaces baseline A or the draft");
      assert.match(handler, /readingRef\.current\) \{ input\.value = ""; return; \}/, "duplicate submission ignored");
      assert.match(handler, /finally \{[\s\S]*input\.value = "";/, "input is reset after every attempt");
      assert.doesNotMatch(source, /draft-session|use-draft-save|draft-autosave/, "panel has no access to autosave");
    });
  } finally { await vite.close(); }
});
