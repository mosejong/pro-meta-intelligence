import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { before, after, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
let vite, fb, panel, dl, solo;
before(async () => {
  vite = await createServer({ root: webRoot, configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  fb = await vite.ssrLoadModule("/app/tester-feedback.ts");
  panel = await vite.ssrLoadModule("/app/tester-feedback-panel.tsx");
  dl = await vite.ssrLoadModule("/app/text-download.ts");
  solo = await vite.ssrLoadModule("/app/solo-draft-history-panel.tsx");
});
after(async () => { await vite?.close(); });

const NOW = new Date(2026, 10, 22, 15, 4);
const CONTEXT = { step: "DRAFT", tab: "DRAFT", mode: "SOLO_RED", completedSets: 1, currentTurn: 12, patchId: "16.20", cutoff: "2026-11-18T01:35:00Z", viewportWidth: 390 };
const full = () => ({
  device: "PHONE", browser: "SAFARI", firstMinute: "SOMEWHAT", stuck: ["SAVE", "SHARE"], expected: "다른 기기에서도 열릴 줄 알았다",
  saveShare: "DIFFERENT", misread: "NO", reuse: "LCK 결승 전에 친구랑", improve: "저장 위치 안내", returnIntent: "MAYBE",
});

test("normalize drops unknown codes, orders stuck points and keeps NONE exclusive", () => {
  const n = fb.normalizeTesterFeedback({ device: "LAPTOP", browser: "CHROME", stuck: ["SHARE", "NONE", "BOGUS", "TEAM_SETUP", "SHARE"], returnIntent: 3 });
  assert.equal(n.device, null);
  assert.equal(n.browser, "CHROME");
  assert.deepEqual(n.stuck, ["TEAM_SETUP", "SHARE"], "fixed option order, deduped, NONE removed beside real points");
  assert.equal(n.returnIntent, null);
  assert.deepEqual(fb.normalizeTesterFeedback({ stuck: ["NONE"] }).stuck, ["NONE"]);
  for (const junk of [null, undefined, 7, "x", []]) assert.equal(fb.hasTesterFeedback(fb.normalizeTesterFeedback(junk)), false);
});

test("free text: control/bidi/zero-width removed, blank lines collapsed, lines and length capped", () => {
  assert.equal(fb.cleanFeedbackText("  a‮b​c \t d\u0007  "), "a b c d");
  assert.equal(fb.cleanFeedbackText("\n\n첫 줄\r\n\r\n\r\n둘째 줄\n\n"), "첫 줄\n\n둘째 줄");
  const many = Array.from({ length: 20 }, (_, i) => `줄${i}`).join("\n");
  assert.equal(fb.cleanFeedbackText(many).split("\n").length, fb.TESTER_FEEDBACK_MAX_LINES);
  const long = "가".repeat(fb.TESTER_FEEDBACK_TEXT_MAX + 50);
  assert.equal(Array.from(fb.cleanFeedbackText(long)).length, fb.TESTER_FEEDBACK_TEXT_MAX);
  assert.equal(fb.cleanFeedbackText(42), "");
});

test("contacts are masked; dates, patches and short numbers are not", () => {
  for (const contact of ["me@example.com", "한글.이름@메일.한국", "010-1234-5678", "01012345678", "+82 10 1234 5678", "010.1234.5678"]) {
    const r = fb.maskContacts(`연락은 ${contact} 로`);
    assert.equal(r.masked, 1, contact);
    assert.ok(!r.text.includes(contact), contact);
    assert.ok(r.text.includes(fb.CONTACT_MASK));
  }
  for (const safe of ["패치 16.20", "2026-11-22", "3세트 20차례", "T1 vs GEN 2:1", "12345678"]) assert.equal(fb.maskContacts(safe).masked, 0, safe);
});

test("draft codec round-trips answers only and rejects malformed or foreign values", () => {
  const stored = fb.serializeTesterFeedbackDraft(full());
  assert.deepEqual(fb.parseTesterFeedbackDraft(stored), fb.normalizeTesterFeedback(full()));
  assert.ok(!stored.includes("16.20"), "context is never stored");
  assert.equal(fb.serializeTesterFeedbackDraft(fb.EMPTY_TESTER_FEEDBACK), null, "empty form clears storage");
  for (const bad of [null, "", "{", "[]", "null", JSON.stringify({ v: 2, answers: full() }), JSON.stringify({ v: 1, answers: [] }),
    JSON.stringify({ v: 1, answers: { device: "LAPTOP" } }), "x".repeat(fb.TESTER_FEEDBACK_DRAFT_MAX_BYTES + 1), 5]) {
    assert.equal(fb.parseTesterFeedbackDraft(bad), null, String(bad).slice(0, 40));
  }
  assert.ok(Object.isFrozen(fb.EMPTY_TESTER_FEEDBACK));
});

test("text lists answered questions in order, masks contacts and appends only coarse context", () => {
  const r = fb.buildTesterFeedbackText({ answers: { ...full(), improve: "연락 주세요 010-9876-5432" }, context: CONTEXT, now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.masked, 1);
  assert.ok(!r.text.includes("9876"));
  const lines = r.text.split("\n");
  assert.equal(lines[0], "[Pro Meta Intelligence 테스트 의견]");
  assert.equal(lines[1], "작성일: 2026-11-22");
  assert.ok(r.text.includes("기기: 휴대폰"));
  assert.ok(r.text.includes("멈추거나 헷갈린 곳: 저장·불러오기, 링크·이미지·글 공유"));
  assert.ok(r.text.indexOf("기기:") < r.text.indexOf("하나만 고친다면:"));
  assert.ok(r.text.includes("방식: 혼자 연습(레드)"));
  assert.ok(r.text.includes("완료한 세트 1개 · 현재 세트 12/20 차례"));
  assert.ok(r.text.includes("화면 폭: 좁은 화면(휴대폰 폭)"));
  assert.ok(!r.text.includes("390"), "exact width is never written");
  assert.ok(!/[{}]|schema|undefined|null/.test(r.text));
});

test("unanswered questions are omitted; multi-line answers are indented; context is optional", () => {
  const r = fb.buildTesterFeedbackText({ answers: { improve: "첫째\n둘째" }, context: null, now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.text, "[Pro Meta Intelligence 테스트 의견]\n작성일: 2026-11-22\n하나만 고친다면:\n  첫째\n  둘째");
  assert.deepEqual(fb.buildTesterFeedbackText({ answers: {}, context: CONTEXT, now: NOW }), { ok: false, reason: "EMPTY" });
  assert.ok(fb.buildTesterFeedbackText({ answers: { device: "PC" }, context: null, now: new Date(Number.NaN) }).text.includes("작성일: 확인 안 됨"));
});

test("context lines clamp counts and clean basis strings", () => {
  const lines = fb.contextLines({ ...CONTEXT, step: "SETUP", mode: "ROOM", completedSets: -3, currentTurn: 99, patchId: "16.20‮\n", cutoff: "", viewportWidth: null });
  assert.deepEqual(lines, [
    "화면: 팀 선택 · 탭: 밴픽 · 방식: 친구 방",
    "진행: 완료한 세트 0개 · 현재 세트 20/20 차례",
    "자료: 패치 16.20 · 기준 시각 확인 안 됨",
    "화면 폭: 확인 안 됨",
  ]);
  assert.equal(fb.cutoffText("2026-11-18T01:35:30.738564+00:00"), "2026-11-18 01:35 UTC");
  assert.equal(fb.cutoffText("2026-11-18T10:35:00+09:00"), "2026-11-18 01:35 UTC");
  assert.equal(fb.cutoffText("fixture"), "fixture");
  assert.equal(fb.cutoffText("2026-99-99T99:99"), "2026-99-99T99:99");
  assert.ok(fb.buildTesterFeedbackText({ answers: { device: "PC" }, context: CONTEXT, now: NOW }).text.includes("기준 시각 2026-11-18 01:35 UTC"));
  assert.equal(fb.viewportBucket(1440), "넓은 화면(PC)");
  assert.equal(fb.viewportBucket(800), "중간 화면(태블릿 폭)");
  assert.equal(fb.viewportBucket(Number.NaN), "확인 안 됨");
});

test("server render shows only the entry button; the form mounts on open", () => {
  const html = renderToStaticMarkup(createElement(panel.TesterFeedbackPanel, { context: { ...CONTEXT, viewportWidth: undefined } }));
  assert.match(html, /테스트 의견 남기기<\/button>/);
  assert.match(html, /<dialog[^>]*class="tester-feedback-dialog"/);
  assert.ok(!/<dialog[^>]* open/.test(html), "dialog starts closed");
  assert.ok(!html.includes("<form"), "no form markup before open");
});

function fakeEnv() {
  const calls = { appended: 0, removed: 0, revoked: 0, clicked: 0, download: null, type: null };
  const anchor = { download: "", style: {}, click() { calls.clicked += 1; calls.download = this.download; }, remove() { calls.removed += 1; } };
  const env = {
    doc: { body: { appendChild() { calls.appended += 1; } }, createElement: () => anchor },
    urls: { createObjectURL: () => "blob:x", revokeObjectURL: () => { calls.revoked += 1; } },
    makeBlob: (_parts, options) => { calls.type = options.type; return {}; },
    schedule: run => run(),
  };
  return { env, calls };
}

test("shared text download uses the given file name; the solo review keeps its own", () => {
  const a = fakeEnv();
  assert.equal(dl.requestTextDownload("의견", panel.TESTER_FEEDBACK_FILE_NAME, a.env), "REQUESTED");
  assert.equal(a.calls.download, "pro-meta-test-feedback.txt");
  assert.equal(a.calls.type, "text/plain;charset=utf-8");
  assert.deepEqual([a.calls.clicked, a.calls.removed, a.calls.revoked], [1, 1, 1]);
  const b = fakeEnv();
  assert.equal(solo.requestSoloHistoryDownload("복기", b.env), "REQUESTED");
  assert.equal(b.calls.download, solo.SOLO_HISTORY_FILE_NAME);
  assert.equal(dl.requestTextDownload("x", "", fakeEnv().env), "UNAVAILABLE");
  assert.equal(dl.requestTextDownload("", "a.txt", fakeEnv().env), "UNAVAILABLE");
});
