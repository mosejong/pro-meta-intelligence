import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const fixture = () => ({
  ok: true,
  target: { baselineRunId: 3, candidateRunId: 7, pairs: 3 },
  ruleset: "core-v1",
  seedListId: "batch-seeds-1-30-v1",
  seeds: [1, 2, 3],
  context: { inputKey: "k", evidenceIdentity: "e", teamOrder: ["t1", "t2"], names: { t1: "Alpha", t2: "Beta" } },
  changes: [{ field: "x" }],
  changeKind: "ASSUMPTION",
  rows: [
    { seed: 1, a: { winner: "t1", minute: 30, reason: "NEXUS", teams: {} }, b: { winner: "t2", minute: 32, reason: "NEXUS", teams: {} },
      delta: { t1: { gold: -1200, kills: -2 }, t2: { gold: 1500, kills: 3 } }, minuteDelta: 2 },
  ],
  summary: {
    denominator: 3,
    wins: { t1: { a: 2, b: 1 }, t2: { a: 1, b: 2 } },
    gold: { t1: { min: -1200, median: -300, max: 400 }, t2: { min: -100, median: 500, max: 1500 } },
    kills: { t1: { min: -2, median: 0, max: 1 }, t2: { min: 0, median: 1, max: 3 } },
    minute: { min: -1, median: 0, max: 2 },
    allZero: false,
  },
});

test("plain-language batch summary", async (t) => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const S = await vite.ssrLoadModule("/app/experiment-batch-summary.ts");
    const label = (id) => ({ t1: "Alpha", t2: "Beta" })[id] ?? id;

    await t.test("does not mutate the result and is deterministic", () => {
      const result = fixture();
      const before = structuredClone(result);
      const first = S.buildBatchSummaryText(result, label);
      const second = S.buildBatchSummaryText(result, label);
      assert.deepEqual(result, before);
      assert.equal(first, second);
      assert.equal(S.buildBatchSummaryText(fixture(), label), first);
    });

    await t.test("includes ids, seed list, pairs, wins/denominator and spreads", () => {
      const text = S.buildBatchSummaryText(fixture(), label);
      assert.match(text, /기준 A #3/);
      assert.match(text, /실행 B #7/);
      assert.match(text, /batch-seeds-1-30-v1/);
      assert.match(text, /1~3번, 모두 3쌍/);
      assert.match(text, /Alpha: .*A 2\/3번 → B 1\/3번/);
      assert.match(text, /Beta: .*A 1\/3번 → B 2\/3번/);
      assert.match(text, /자원 차이\(B−A\): 최소 -1,200, 중앙 -300, 최대 \+400/);
      assert.match(text, /킬 차이\(B−A\): 최소 0, 중앙 \+1, 최대 \+3/);
      assert.match(text, /끝난 분 차이\(B−A\): 최소 -1, 중앙 0, 최대 \+2/);
    });

    await t.test("plain text with model-internal boundary and no real-effect claims", () => {
      const text = S.buildBatchSummaryText(fixture(), label);
      assert.ok(!/[{}<>]/.test(text), "no JSON/markup");
      assert.ok(!text.includes("t1") && !text.includes("t2"), "uses labels, not raw ids");
      assert.ok(text.includes("모델 내부 실험"));
      assert.ok(text.includes("실제 승률·실전 예측이 아닙니다"));
      assert.ok(text.includes("선수·챔피언·룬·아이템의 효과는 반영하지 않았습니다"));
      assert.ok(!/%/.test(text), "no win-rate percentage");
    });

    await t.test("same-assumption and all-zero notes", () => {
      const same = { ...fixture(), changeKind: "NONE" };
      assert.match(S.buildBatchSummaryText(same, label), /가정이 같아서 모든 쌍의 차이가 0/);
      const zero = fixture(); zero.summary.allZero = true;
      assert.match(S.buildBatchSummaryText(zero, label), /차이가 모두 0이었습니다/);
    });
  } finally {
    await vite.close();
  }
});
