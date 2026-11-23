import { test, expect } from "@playwright/test";
import { enterDraftForReview } from "./enter-draft-review.mjs";
import { readFile } from "node:fs/promises";

const root = "/pro-meta-intelligence/";
const solo = page => page.getByRole("region", { name: "혼자 밴픽 연습", exact: true });
const review = page => page.locator(".solo-history");
const progress = page => page.locator(".draft-turn-progress");

async function sidecar(page, mutate = false) {
  return page.evaluate(mutate => new Promise((resolve, reject) => {
    const open = indexedDB.open("pro-meta-draft", 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("sessions", mutate ? "readwrite" : "readonly");
      const store = tx.objectStore("sessions");
      let value = null;
      if (mutate) store.put('{"corrupt":true}', "current-solo-review");
      else {
        const request = store.get("current-solo-review");
        request.onsuccess = () => { value = request.result ?? null; };
      }
      tx.oncomplete = () => { db.close(); resolve(value); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), mutate);
}

async function start(page, side) {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", {
    configurable: true, value: { writeText: async () => { throw new Error("denied"); } },
  }));
  await page.goto(root);
  await enterDraftForReview(page);
  await enterDraftForReview(page);
  await solo(page).getByLabel("내 진영", { exact: true }).selectOption(side);
  await solo(page).getByRole("checkbox", { name: "상대 자동 밴픽", exact: true }).check();
  if (side === "RED") await expect(progress(page)).toHaveAttribute("value", "1");
  for (const expected of side === "BLUE" ? [2, 4] : [3, 5]) {
    await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
    await page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ }).click();
    await expect(progress(page)).toHaveAttribute("value", String(expected));
  }
  const turns = side === "BLUE" ? [2, 4] : [1, 3, 5];
  await expect.poll(async () => {
    const saved = await sidecar(page);
    return typeof saved === "string" ? JSON.parse(saved).records.map(r => r.turn) : null;
  }).toEqual(turns);
  return turns;
}

async function copyText(page) {
  if (await review(page).getAttribute("open") === null) await review(page).locator(":scope > summary").click();
  await review(page).getByRole("button", { name: "자동 선택 복기 복사", exact: true }).click();
  return review(page).locator("textarea").inputValue();
}

for (const side of ["BLUE", "RED"]) {
  test(`${side} saved review reloads unchanged without restarting the automatic opponent`, async ({ page }, testInfo) => {
    const turns = await start(page, side);
    const original = await copyText(page);
    const before = page.url();
    await page.reload();
    await enterDraftForReview(page);
    await expect(progress(page)).toHaveAttribute("value", side === "BLUE" ? "4" : "5");
    await expect(solo(page).getByLabel("내 진영", { exact: true })).toHaveValue(side);
    await expect(solo(page).getByRole("checkbox", { name: "상대 자동 밴픽", exact: true })).not.toBeChecked();
    await expect(review(page).locator(":scope > summary")).toContainText(`(${turns.length})`);
    expect(await copyText(page)).toBe(original);
    await expect(review(page)).toContainText(/저장.*연습.*메모/);
    await expect(page.locator(".solo-explain .solo-draft-last")).toHaveCount(0);
    expect(page.url()).toBe(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await review(page).screenshot({ path: testInfo.outputPath(`restored-review-${side.toLowerCase()}.png`) });
  });
}

test("corrupt saved notes are dropped while the saved board still reloads", async ({ page }) => {
  await start(page, "BLUE");
  await sidecar(page, true);
  await page.reload();
  await enterDraftForReview(page);
  await expect(progress(page)).toHaveAttribute("value", "4");
  await expect(review(page)).toHaveCount(0);
  await expect(solo(page).getByRole("checkbox", { name: "상대 자동 밴픽", exact: true })).not.toBeChecked();
  await expect.poll(() => sidecar(page)).toBeNull();
});

test("undo and manual-side changes prune restored notes permanently across further reloads", async ({ page }) => {
  await start(page, "BLUE");
  await page.reload();
  await enterDraftForReview(page);
  await expect(progress(page)).toHaveAttribute("value", "4");
  await page.locator(".draft-actions").getByRole("button", { name: /되돌리기/ }).click();
  await expect(progress(page)).toHaveAttribute("value", "3");
  await expect.poll(async () => {
    const saved = await sidecar(page);
    return typeof saved === "string" ? JSON.parse(saved).records.map(r => r.turn) : null;
  }).toEqual([2]);
  await page.reload();
  await enterDraftForReview(page);
  await expect(progress(page)).toHaveAttribute("value", "3");
  await expect(review(page).locator(":scope > summary")).toContainText("(1)");
  await solo(page).getByLabel("내 진영", { exact: true }).selectOption("RED");
  await expect(review(page)).toHaveCount(0);
  await expect.poll(() => sidecar(page)).toBeNull();
  await page.reload();
  await enterDraftForReview(page);
  await expect(progress(page)).toHaveAttribute("value", "3");
  await expect(review(page)).toHaveCount(0);
});

test("reopening an identical named practice clears private autosave notes", async ({ page }) => {
  await start(page, "BLUE");
  const library = page.locator("details.draft-practice-library");
  await library.locator(":scope > summary").click();
  await library.getByLabel("연습 이름").fill("복기 분리 확인");
  await library.getByRole("button", { name: "이 연습 저장", exact: true }).click();
  await expect(library.getByRole("status")).toContainText("저장했습니다");
  await library.getByRole("button", { name: "복기 분리 확인 열기", exact: true }).click();
  await library.getByRole("alertdialog").getByRole("button", { name: "바꾸기", exact: true }).click();
  await expect(progress(page)).toHaveAttribute("value", "4");
  await expect(review(page)).toHaveCount(0);
  await expect.poll(() => sidecar(page)).toBeNull();
  await page.reload();
  await enterDraftForReview(page);
  await expect(progress(page)).toHaveAttribute("value", "4");
  await expect(review(page)).toHaveCount(0);
});

test("accepting an identical shared draft clears private autosave notes", async ({ page }) => {
  await start(page, "BLUE");
  await page.getByRole("button", { name: "밴픽 링크 복사", exact: true }).click();
  const href = await page.getByLabel("복사할 밴픽 링크", { exact: true }).inputValue();
  await page.evaluate(value => { location.hash = new URL(value).hash; }, href);
  await page.getByRole("button", { name: "이 밴픽 불러오기", exact: true }).click();
  await expect(progress(page)).toHaveAttribute("value", "4");
  await expect(review(page)).toHaveCount(0);
  await expect.poll(() => sidecar(page)).toBeNull();
  await page.reload();
  await enterDraftForReview(page);
  await expect(progress(page)).toHaveAttribute("value", "4");
  await expect(review(page)).toHaveCount(0);
});

test("reset clears saved notes and scenario import restores only the board", async ({ page }) => {
  await start(page, "BLUE");
  const tools = page.locator(".draft-session-details");
  if (await tools.getAttribute("open") === null) await tools.locator(":scope > summary").click();
  const pending = page.waitForEvent("download");
  await page.locator(".draft-session-controls").getByRole("button", { name: "시리즈 JSON 저장", exact: true }).click();
  const download = await pending;
  const filePath = await download.path();
  const exported = await readFile(filePath, "utf8");
  expect(exported).not.toContain("solo-review-retention");
  expect(exported).not.toContain("current-solo-review");
  await page.getByRole("button", { name: "현재 세트 초기화", exact: true }).click();
  await page.getByRole("dialog", { name: "현재 세트를 초기화할까요?", exact: true })
    .getByRole("button", { name: "초기화", exact: true }).click();
  await expect(progress(page)).toHaveAttribute("value", "0");
  await expect(review(page)).toHaveCount(0);
  await expect.poll(() => sidecar(page)).toBeNull();
  await page.locator('.draft-session-controls input[type="file"]').setInputFiles(filePath);
  await expect(progress(page)).toHaveAttribute("value", "4");
  await expect(review(page)).toHaveCount(0);
  await expect.poll(() => sidecar(page)).toBeNull();
  await page.reload();
  await enterDraftForReview(page);
  await expect(progress(page)).toHaveAttribute("value", "4");
  await expect(review(page)).toHaveCount(0);
});
