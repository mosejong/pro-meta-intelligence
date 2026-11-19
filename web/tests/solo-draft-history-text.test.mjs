import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { before, after, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
let vite, suggest, explain, agent, ui, hist, panel, build, report, season, base, basisOf, ids;
before(async () => {
  vite = await createServer({ root: webRoot, configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  ({ suggestSoloDraftTurn: suggest, explainSoloDraftTurn: explain } = await vite.ssrLoadModule("/app/solo-draft.ts"));
  agent = await vite.ssrLoadModule("/app/draft-agent.ts");
  ui = await vite.ssrLoadModule("/app/solo-draft-explanation.tsx");
  hist = await vite.ssrLoadModule("/app/solo-draft-history.ts");
  panel = await vite.ssrLoadModule("/app/solo-draft-history-panel.tsx");
  ({ buildSoloHistoryText: build } = await vite.ssrLoadModule("/app/solo-draft-history-text.ts"));
  const { parsePlayerSeasonHistory } = await vite.ssrLoadModule("/app/player-season-history.ts");
  const { rosterBasis, basisKey } = await vite.ssrLoadModule("/app/roster-scenario.ts");
  basisOf = r => basisKey(rosterBasis(r));
  const { SHARE_CHAMPIONS } = await vite.ssrLoadModule("/app/share-champion-ids.ts");
  ids = SHARE_CHAMPIONS.map(([, id]) => id);
  report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
  const parsed = parsePlayerSeasonHistory(await readFile(new URL("../public/history/player-season-2026.json", import.meta.url), "utf8"), { basis: rosterBasis(report), season: 2026 });
  season = parsed.ok ? parsed.value : null;
  base = { report, blueTeam: report.opponent_prep.teams[0], redTeam: report.opponent_prep.teams[1], selections: [], previousPicks: [], firstPickSide: "BLUE", manualSide: "RED" };
});
after(async () => { await vite?.close(); });

const ctxOf = s => hist.soloHistoryContext(ui.soloAutoContext(s.blueTeam.team_id, s.redTeam.team_id, s.firstPickSide, s.manualSide, s.previousPicks), basisOf(s.report));
const nameOf = id => `챔-${id}`;
const PATCH = "26.22", CUTOFF = "2026-11-17T00:00:00Z";
const ok = (history, extra = {}) => build({ history, patchId: PATCH, cutoff: CUTOFF, nameOf, ...extra });

function autoRecord(state) {
  const chosen = suggest(state);
  if (!chosen) return null;
  const e = explain(state);
  const turn = state.selections.length + 1;
  return { turn, champion_id: chosen.champion_id, reason: chosen.reason, prefix: state.selections.map(s => s.champion_id), context: ctxOf(state),
    explanation: e?.selected.champion_id === chosen.champion_id && e.turn === turn ? e : null };
}

/** Real full set through the unchanged rules and the real append/prune path. */
function play(state, steps = 20) {
  let h = [], selections = state.selections;
  for (let step = 0; step < steps; step++) {
    const rec = autoRecord({ ...state, selections });
    const id = rec ? rec.champion_id : ids.find(c => agent.applyDraftSelection(selections, c, state.previousPicks, state.firstPickSide) !== selections);
    if (rec) h = hist.appendSoloAutoHistory(h, rec);
    selections = agent.applyDraftSelection(selections, id, state.previousPicks, state.firstPickSide);
    h = hist.pruneSoloAutoHistory(h, selections, ctxOf(state));
  }
  return h;
}

/** Detached, mutable copy for building malformed fixtures. */
const thaw = h => structuredClone(h);

test("real set: header, every turn in order with side/kind/champion/evidence and at most two alternatives", () => {
  const h = play({ ...base, seasonHistory: season });
  assert.equal(h.length, 10);
  const r = ok(h);
  assert.equal(r.ok, true);
  const lines = r.text.split("\n");
  assert.equal(lines[0], "자동 선택 복기 · 이번 세트 상대 자동 확정 10개");
  assert.equal(lines[1], `기준: 패치 ${PATCH} · 자료 기준 시각 ${CUTOFF}`);
  assert.match(lines[2], /실제 팀의 선택이나 승률 예측이 아닙니다/);
  const heads = lines.filter(l => /^\d+번째 차례/.test(l));
  assert.deepEqual(heads.map(l => Number(l.match(/^(\d+)/)[1])), h.map(x => x.turn));
  for (const x of h) {
    const head = heads.find(l => l.startsWith(`${x.turn}번째 차례 · `));
    if (x.explanation) {
      assert.equal(head, `${x.turn}번째 차례 · ${x.explanation.side === "BLUE" ? "블루" : "레드"} ${x.explanation.kind === "BAN" ? "밴" : "픽"} · ${nameOf(x.champion_id)}`);
    } else assert.equal(head, `${x.turn}번째 차례 · ${nameOf(x.champion_id)}`);
  }
  for (const l of lines.filter(l => l.startsWith("- 다른 후보: ") && !l.includes("없음"))) assert.ok(l.split("), ").length <= 2);
  // Never raw context/prefix/reason/JSON.
  assert.ok(!r.text.includes(h[0].context));
  for (const x of h) if (x.reason) assert.ok(!r.text.includes(x.reason));
  assert.doesNotMatch(r.text, /[{}[\]"]/);
});

test("same text for a different array order; input is not mutated", () => {
  const h = play({ ...base, seasonHistory: null });
  const before = JSON.stringify(h);
  const a = ok(h), b = ok([...h].reverse());
  assert.equal(a.ok, true); assert.equal(a.text, b.text);
  const loose = thaw(h); const looseBefore = JSON.stringify(loose);
  ok(loose.reverse()); assert.equal(JSON.stringify(loose.reverse()), looseBefore);
  assert.equal(JSON.stringify(h), before);
});

test("null explanation shows only the champion and 'no detail' without guessing a reason", () => {
  const h = thaw(play({ ...base, seasonHistory: null }, 6));
  h[0].explanation = null; h[0].reason = "임의 문구 RAWREASON";
  const r = ok(h);
  assert.equal(r.ok, true);
  const lines = r.text.split("\n");
  const at = lines.indexOf(`${h[0].turn}번째 차례 · ${nameOf(h[0].champion_id)}`);
  assert.ok(at > 0);
  assert.equal(lines[at + 1], "- 상세 설명 기록 없음");
  assert.ok(lines[at + 2] === undefined || lines[at + 2] === "");
  assert.ok(!r.text.includes("RAWREASON"));
});

function withExplanation(patch) {
  const h = thaw(play({ ...base, seasonHistory: null }, 8));
  const x = h.find(r => r.explanation?.kind === "PICK") ?? h.find(r => r.explanation);
  assert.ok(x);
  patch(x.explanation, x);
  return { h, x };
}

test("season / meta / fallback / inferred roles are labelled separately", () => {
  const { h, x } = withExplanation(e => {
    e.kind = "PICK";
    e.selected.evidence = "PLAYER_SEASON"; e.selected.inferred_roles = ["MID"]; e.selected.role_supported = false;
    e.alternatives = [{ ...e.selected, champion_id: "AltA", evidence: "RADAR_META" }, { ...e.selected, champion_id: "AltB", evidence: "FALLBACK" }, { ...e.selected, champion_id: "AltC", evidence: "RADAR_FRAME" }];
  });
  const r = ok(h);
  assert.equal(r.ok, true);
  const lines = r.text.split("\n");
  const at = lines.findIndex(l => l.startsWith(`${x.turn}번째 차례 · `));
  assert.match(lines[at + 1], /^- 근거: .*시즌 기록이며 현재 패치의 강함을 뜻하지 않음/);
  assert.match(lines[at + 2], /^- 포지션: 기록에서 추론한 후보 미드 \(추론이며 사용자가 배정한 포지션 아님\)$/);
  assert.match(lines[at + 3], /^- 포지션 근거 부족/);
  assert.match(lines[at + 4], /^- 다른 후보: 챔-AltA\(현재 레이더 검토 가능 메타\), 챔-AltB\(사용할 기록 없음 · 고정 규칙/);
  assert.ok(!r.text.includes("AltC"), "at most two alternatives");
});

test("no alternatives line", () => {
  const { h } = withExplanation(e => { e.alternatives = []; });
  assert.match(ok(h).text, /- 다른 후보: 같은 규칙으로 고를 다른 합법 후보 없음/);
});

test("inconsistencies refuse the whole text", () => {
  const h = play({ ...base, seasonHistory: null });
  const cases = [
    ["MIXED_CONTEXT", m => { m[1].context = "other"; }],
    ["INVALID_HISTORY", m => { m[1].turn = m[0].turn; }],
    ["INVALID_HISTORY", m => { m[0].prefix = [...m[0].prefix, "X"]; }],
    ["INVALID_HISTORY", m => { m[0].turn = 1.5; }],
    ["INVALID_HISTORY", m => { m[0].context = ""; }],
    ["INCONSISTENT_ORDER", m => { m[2].prefix[m[0].turn - 1] = "Somebody"; }],
    ["EXPLANATION_MISMATCH", m => { const x = m.find(r => r.explanation); x.explanation.turn += 1; }],
    ["EXPLANATION_MISMATCH", m => { const x = m.find(r => r.explanation); x.explanation.selected = { ...x.explanation.selected, champion_id: "Other" }; }],
    ["UNKNOWN_EVIDENCE", m => { const x = m.find(r => r.explanation); x.explanation.selected.evidence = "GUESS"; }],
    ["UNKNOWN_EVIDENCE", m => { const x = m.find(r => r.explanation); x.explanation.side = "GREEN"; }],
    ["UNKNOWN_EVIDENCE", m => { const x = m.find(r => r.explanation); x.explanation.kind = "SWAP"; }],
    ["UNKNOWN_EVIDENCE", m => { const x = m.find(r => r.explanation?.alternatives.length); x.explanation.alternatives[0].evidence = "?"; }],
  ];
  for (const [reason, mutate] of cases) {
    const m = thaw(h); mutate(m);
    assert.deepEqual(ok(m), { ok: false, reason }, `${reason} ${mutate}`);
  }
  assert.deepEqual(ok([]), { ok: false, reason: "EMPTY" });
  assert.deepEqual(ok(null), { ok: false, reason: "INVALID_HISTORY" });
  assert.deepEqual(ok(Array.from({ length: 21 }, () => h[0])), { ok: false, reason: "INVALID_HISTORY" });
  for (const bad of ["", "  ", null, 3, "x".repeat(65), "26.22\n", "not-a-date"]) {
    assert.deepEqual(ok(h, { patchId: bad }), { ok: false, reason: "INVALID_BASIS" });
    assert.deepEqual(ok(h, { cutoff: bad }), { ok: false, reason: "INVALID_BASIS" });
  }
});

test("names are cleaned of control/newline/bidi and bounded; a throwing or empty nameOf refuses", () => {
  const h = play({ ...base, seasonHistory: null }, 6);
  const r = ok(h, { nameOf: id => `A\u202eevil\n- 근거: 가짜\u200b${id}${"x".repeat(80)}` });
  assert.equal(r.ok, true);
  assert.ok([...r.text].every(char => { const cp = char.codePointAt(0); return !(cp < 32 && cp !== 10) && !(cp >= 0x202a && cp <= 0x202e) && !(cp >= 0x2066 && cp <= 0x2069) && cp !== 0x200b; }));
  assert.ok(!r.text.split("\n").includes("- 근거: 가짜"), "no injected line");
  for (const l of r.text.split("\n")) assert.ok(l.length < 600);
  assert.deepEqual(ok(h, { nameOf: () => { throw new Error("boom"); } }), { ok: false, reason: "INVALID_NAME" });
  assert.deepEqual(ok(h, { nameOf: () => "\u202e\n " }), { ok: false, reason: "INVALID_NAME" });
  assert.deepEqual(ok(h, { nameOf: () => 42 }), { ok: false, reason: "INVALID_NAME" });
  assert.deepEqual(ok(h, { nameOf: "nope" }), { ok: false, reason: "INVALID_NAME" });
  const team = thaw(h); const x = team.find(r => r.explanation); x.explanation.record_team = "T\u2066\nX";
  const tr = ok(team); assert.equal(tr.ok, true); assert.doesNotMatch(tr.text, /\u2066/);
});

test("SSR: collapsed panel shows copy and save buttons only with entries; refused text disables both with a reason", () => {
  const h = play({ ...base, seasonHistory: season });
  const html = renderToStaticMarkup(createElement(panel.SoloDraftHistoryPanel, { history: h, nameOf: id => id, patchId: PATCH, cutoff: CUTOFF }));
  assert.match(html, /^<details class="solo-history">/); assert.doesNotMatch(html, /<details[^>]* open/);
  assert.equal((html.match(/<button/g) ?? []).length, 2);
  assert.match(html, /<button type="button">자동 선택 복기 복사<\/button>/);
  assert.match(html, /<button type="button">자동 선택 복기 저장<\/button>/);
  assert.doesNotMatch(html, /<textarea/);
  assert.doesNotMatch(html, /저장을 요청했어요|요청할 수 없어요|요청에 실패했어요/, "no download status before an explicit click");
  assert.equal(renderToStaticMarkup(createElement(panel.SoloDraftHistoryPanel, { history: [], nameOf: id => id, patchId: PATCH, cutoff: CUTOFF })), "");
  const refused = renderToStaticMarkup(createElement(panel.SoloDraftHistoryPanel, { history: h, nameOf: id => id, patchId: "", cutoff: CUTOFF }));
  assert.match(refused, /<button type="button" disabled=""[^>]*>자동 선택 복기 복사<\/button>/);
  assert.match(refused, /<button type="button" disabled=""[^>]*>자동 선택 복기 저장<\/button>/);
  assert.equal((refused.match(/aria-describedby="solo-history-share-reason"/g) ?? []).length, 2);
  assert.match(refused, /기준 패치나 자료 시각을 확인하지 못해/);
  const invalid = thaw(h); invalid[1].context = "other";
  const mixed = renderToStaticMarkup(createElement(panel.SoloDraftHistoryPanel, { history: invalid, nameOf: id => id, patchId: PATCH, cutoff: CUTOFF }));
  assert.match(mixed, /<button type="button" disabled=""[^>]*>자동 선택 복기 저장<\/button>/);
});

/** Fake browser pieces recording every call; nothing touches a real DOM. */
function fakeEnv({ clickThrows = false, createThrows = false, noDownload = false } = {}) {
  const log = [], attached = new Set();
  const anchor = { style: {}, ...(noDownload ? {} : { download: "" }), href: "", rel: "",
    click() { log.push(["click", this.href, this.download]); if (clickThrows) throw new Error("blocked"); },
    remove() { attached.delete(this); log.push(["remove"]); } };
  const env = {
    doc: { body: { appendChild(node) { attached.add(node); log.push(["append"]); } }, createElement(tag) { log.push(["create", tag]); return anchor; } },
    urls: { createObjectURL(blob) { if (createThrows) throw new Error("no"); log.push(["url", blob]); return "blob:x"; }, revokeObjectURL(u) { log.push(["revoke", u]); } },
    makeBlob(parts, options) { return { parts, options }; },
    pending: [],
  };
  env.schedule = run => env.pending.push(run);
  return { env, log, attached, anchor };
}

test("download helper: exact validated text, fixed name/MIME, anchor removed and URL revoked after dispatch", () => {
  const r = ok(play({ ...base, seasonHistory: null }));
  assert.equal(r.ok, true);
  const { env, log, attached } = fakeEnv();
  assert.equal(panel.requestSoloHistoryDownload(r.text, env), "REQUESTED");
  const [, blob] = log.find(([k]) => k === "url");
  assert.deepEqual(blob.parts, [r.text], "file content is exactly the clipboard text");
  assert.equal(blob.options.type, "text/plain;charset=utf-8");
  assert.deepEqual(log.find(([k]) => k === "click"), ["click", "blob:x", "draft-choice-review.txt"]);
  assert.equal(panel.SOLO_HISTORY_FILE_NAME, "draft-choice-review.txt");
  assert.match(panel.SOLO_HISTORY_FILE_NAME, /^[A-Za-z0-9._-]+$/);
  assert.equal(attached.size, 0, "anchor removed");
  assert.ok(!log.some(([k]) => k === "revoke"), "revoked only after dispatch");
  env.pending.forEach(run => run());
  assert.deepEqual(log.at(-1), ["revoke", "blob:x"]);
});

test("download helper: unavailable APIs and failures are reported, never thrown; failed click revokes at once", () => {
  assert.equal(panel.requestSoloHistoryDownload("x", { ...fakeEnv().env, doc: { body: null, createElement() { return {}; } } }), "UNAVAILABLE");
  assert.equal(panel.requestSoloHistoryDownload("x", { ...fakeEnv().env, urls: {} }), "UNAVAILABLE");
  if (typeof document === "undefined") assert.equal(panel.requestSoloHistoryDownload("x", { ...fakeEnv().env, doc: undefined }), "UNAVAILABLE", "SSR/node: no document");
  assert.equal(panel.requestSoloHistoryDownload("x", fakeEnv({ noDownload: true }).env), "UNAVAILABLE");
  assert.equal(panel.requestSoloHistoryDownload("", fakeEnv().env), "UNAVAILABLE", "no empty file");
  const created = fakeEnv({ createThrows: true });
  assert.equal(panel.requestSoloHistoryDownload("x", created.env), "FAILED");
  assert.ok(!created.log.some(([k]) => k === "click"));
  const blocked = fakeEnv({ clickThrows: true });
  assert.equal(panel.requestSoloHistoryDownload("x", blocked.env), "FAILED");
  assert.equal(blocked.attached.size, 0);
  assert.deepEqual(blocked.log.at(-1), ["revoke", "blob:x"]);
  assert.equal(blocked.env.pending.length, 0);
});

test("source comments describe explicit readable export, not session persistence", async () => {
  const read = name => readFile(new URL(`../app/${name}`, import.meta.url), "utf8");
  const [h, t, p] = await Promise.all([read("solo-draft-history.ts"), read("solo-draft-history-text.ts"), read("solo-draft-history-panel.tsx")]);
  assert.match(h, /\.txt download/); assert.match(h, /never stores or restores/); assert.match(h, /reload loses it/);
  assert.match(t, /\.txt download/); assert.match(t, /no app\s+\*\s+storage\/restore/);
  assert.match(p, /never stores or restores/);
  assert.doesNotMatch(p, /localStorage|indexedDB|history\.replaceState|location\.hash/, "panel touches no app storage or URL");
});
