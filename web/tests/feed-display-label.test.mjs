import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createServer } from "vite";

test("feed labels are shown as plain Korean with the data date", async () => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { feedDisplayLabel } = await vite.ssrLoadModule("/app/feed-display-label.ts");
    assert.equal(feedDisplayLabel("STALE · REVIEW ONLY", "2026-11-24T04:17:26+00:00"), "공개 경기 기준 11/24");
    assert.equal(feedDisplayLabel("LIVE PUBLISHED FEED", "2026-11-24T20:00:00Z"), "공개 경기 기준 11/25", "Korea time");
    assert.equal(feedDisplayLabel("LIVE PUBLISHED FEED", null), "공개 경기 기록");
    assert.equal(feedDisplayLabel("DEMO FALLBACK", null), "예시 데이터 · 실제 기록 불러오기 실패");
    assert.equal(feedDisplayLabel("FEED CONNECTING", null), "데이터 불러오는 중");
    assert.equal(feedDisplayLabel("REFRESH FAILED · PREVIOUS FEED", null), "새로고침 실패 · 이전 데이터");
    assert.equal(feedDisplayLabel("SOMETHING ELSE", null), "SOMETHING ELSE");
  } finally { await vite.close(); }
});

test("a shared draft preview lists each side's bans and picks by name", async () => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { sharedSideSummary } = await vite.ssrLoadModule("/app/draft-share-panel.tsx");
    const session = { selections: [
      { side: "BLUE", kind: "BAN", champion_id: "Ahri" }, { side: "RED", kind: "BAN", champion_id: "Vi" },
      { side: "BLUE", kind: "BAN", champion_id: "Rumble" }, { side: "BLUE", kind: "PICK", champion_id: "Azir" },
    ] };
    const nameOf = (id) => `챔-${id}`;
    assert.equal(sharedSideSummary(session, "BLUE", nameOf), "밴 챔-Ahri, 챔-Rumble · 픽 챔-Azir");
    assert.equal(sharedSideSummary(session, "RED", nameOf), "밴 챔-Vi");
    assert.equal(sharedSideSummary({ selections: [] }, "RED", nameOf), "아직 없음");
  } finally { await vite.close(); }
});

test("result sharing uses the native share sheet, then the clipboard, then explains", async () => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { shareDraftLink } = await vite.ssrLoadModule("/app/draft-result-panel.tsx");
    const shared = [];
    assert.equal(await shareDraftLink("https://x/#draft=a", "A vs B", { share: async (d) => { shared.push(d); } }), null);
    assert.deepEqual(shared, [{ title: "A vs B", text: "A vs B", url: "https://x/#draft=a" }]);
    const abort = Object.assign(new Error("x"), { name: "AbortError" });
    assert.equal(await shareDraftLink("u", "t", { share: async () => { throw abort; } }), null, "cancelling the sheet is silent");
    const copied = [];
    assert.match(await shareDraftLink("u", "t", { clipboard: { writeText: async (v) => { copied.push(v); } } }), /복사했어요/);
    assert.deepEqual(copied, ["u"]);
    assert.match(await shareDraftLink("u", "t", {}), /직접 복사/);
    assert.match(await shareDraftLink("u", "t", { clipboard: { writeText: async () => { throw new Error("denied"); } } }), /직접 복사/);
  } finally { await vite.close(); }
});
