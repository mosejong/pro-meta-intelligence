import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const root = "/pro-meta-intelligence/";
const progress = (page) => page.locator(".draft-turn-progress");
const picker = (page) => page.locator(".draft-picker-grid button:not(:disabled)");
const confirm = (page) => page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ });

async function openStudio(page) {
  await page.goto(root);
  await expect(page.getByRole("heading", { name: "모의 밴픽", exact: true })).toBeVisible();
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
  await expect(picker(page).first()).toBeEnabled();
}

async function choose(page, index = 0, keyboard = false) {
  const button = picker(page).nth(index);
  if (keyboard) { await button.focus(); await page.keyboard.press("Enter"); }
  else await button.click();
  await expect(confirm(page)).toBeEnabled();
}

async function commit(page, turn, keyboard = false) {
  if (keyboard) { await confirm(page).focus(); await page.keyboard.press("Enter"); }
  else await confirm(page).click();
  await expect(progress(page)).toHaveAttribute("value", String(turn));
}

async function finish(page, firstIndex = 0, keyboard = false) {
  for (let i = 0; i < 20; i += 1) {
    await choose(page, i === 0 ? firstIndex : 0, keyboard);
    await commit(page, i + 1, keyboard);
  }
}

async function saved(page) {
  const details = page.locator(".draft-session-details");
  if ((await details.getAttribute("open")) === null) await details.locator("summary").click();
  await expect(details.getByRole("status").filter({ hasText: "이 기기에 저장됨" })).toBeVisible();
}

test("stage, cancel, confirm, undo and refresh preserve the actual draft", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openStudio(page);
  await expect(confirm(page)).toBeDisabled();
  await choose(page);
  await page.getByRole("button", { name: "선택 취소", exact: true }).click();
  await expect(confirm(page)).toBeDisabled();
  await expect(progress(page)).toHaveAttribute("value", "0");
  await choose(page); await commit(page, 1);
  await choose(page); await commit(page, 2);
  await page.getByRole("button", { name: "한 수 되돌리기", exact: true }).click();
  await expect(progress(page)).toHaveAttribute("value", "1");
  await choose(page);
  const stagedName = await page.locator(".draft-lock-in > div > span").textContent();
  await saved(page);
  await page.reload();
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
  await expect(progress(page)).toHaveAttribute("value", "1");
  await expect(page.locator(".draft-lock-in > div > span")).toHaveText(stagedName);
  await expect(confirm(page)).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("restored-draft.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("a completed A and edited B export and replay without replacing the live draft", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await openStudio(page);
  await finish(page);
  const comparison = page.getByRole("region", { name: "드래프트 A/B 비교", exact: true });
  await comparison.getByRole("button", { name: "현재 완료 드래프트를 기준 A로 고정", exact: true }).click();
  await page.getByRole("button", { name: "현재 세트 초기화", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "계속 분석하기", exact: true }).click();
  await expect(progress(page)).toHaveAttribute("value", "20");
  await page.getByRole("button", { name: "현재 세트 초기화", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "초기화", exact: true }).click();
  await expect(progress(page)).toHaveAttribute("value", "0");
  await finish(page, 1);
  await expect(comparison).toContainText("변경 밴");
  const downloadPromise = page.waitForEvent("download");
  await comparison.getByRole("button", { name: "A/B 비교 JSON 저장", exact: true }).click();
  const download = await downloadPromise;
  const filePath = testInfo.outputPath("comparison.json");
  await download.saveAs(filePath);
  const artifact = JSON.parse(await readFile(filePath, "utf8"));
  expect(artifact.artifact_type).toBe("public-draft-comparison");
  expect(artifact.comparison.changes.length).toBeGreaterThan(0);
  expect(artifact.comparison.unchanged_count).toBeLessThan(20);
  const fileInput = comparison.locator('input[type="file"]');
  await fileInput.setInputFiles(filePath);
  await expect(comparison.getByRole("status").filter({ hasText: "기록된 결과와 일치" })).toBeVisible();
  await expect(progress(page)).toHaveAttribute("value", "20");
  await expect(comparison.getByRole("button", { name: "현재 B로 기준 A 교체", exact: true })).toBeEnabled();
  const changed = structuredClone(artifact);
  changed.comparison.unchanged_count += 1;
  await fileInput.setInputFiles({ name: "tampered.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(changed)) });
  await expect(comparison.getByRole("alert")).toContainText("다릅니다");
  await expect(progress(page)).toHaveAttribute("value", "20");
  await fileInput.setInputFiles(filePath);
  await expect(comparison.getByRole("status").filter({ hasText: "기록된 결과와 일치" })).toBeVisible();
  await comparison.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("comparison-replayed.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("keyboard activation and next-set Fearless locks survive refresh", async ({ page }) => {
  await openStudio(page);
  await finish(page, 0, true);
  await page.getByRole("button", { name: "세트 저장하고 다음 세트", exact: true }).click();
  await expect(progress(page)).toHaveAttribute("value", "0");
  await expect(page.locator(".draft-series")).toContainText("피어리스 · 2세트");
  await expect(page.locator(".draft-series")).toContainText("픽 10개");
  await page.getByRole("checkbox", { name: "선택 가능한 챔피언만", exact: true }).uncheck();
  await expect(page.locator(".draft-picker-grid button:disabled")).toHaveCount(10);
  await saved(page);
  await page.reload();
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
  await expect(page.locator(".draft-series")).toContainText("피어리스 · 2세트");
  await page.getByRole("checkbox", { name: "선택 가능한 챔피언만", exact: true }).uncheck();
  await expect(page.locator(".draft-picker-grid button:disabled")).toHaveCount(10);
});

test("an injected storage failure can retry the latest staged draft", async ({ page }) => {
  // Isolated fault injection, not a claim of reproducing a real quota/disk failure.
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    let abortNextDraft = true;
    IDBObjectStore.prototype.put = function (value, key) {
      const request = put.call(this, value, key);
      if (this.name === "sessions" && key === "current" && abortNextDraft) {
        abortNextDraft = false;
        const transaction = this.transaction;
        queueMicrotask(() => transaction.abort());
      }
      return request;
    };
  });
  await openStudio(page);
  await choose(page);
  const staged = await page.locator(".draft-lock-in > div > span").textContent();
  await page.getByRole("button", { name: "다시 저장", exact: true }).click();
  await expect(page.getByRole("button", { name: "다시 저장", exact: true })).toHaveCount(0);
  await saved(page);
  await page.reload();
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
  await expect(page.locator(".draft-lock-in > div > span")).toHaveText(staged);
  await expect(progress(page)).toHaveAttribute("value", "0");
});

test("team changes, duplicate prevention and red-first selection remain usable", async ({ page }) => {
  await openStudio(page);
  async function selectGenG(side) {
    await page.getByRole("button", { name: new RegExp(`^${side} TEAM:`) }).click();
    const dialog = page.getByRole("dialog", { name: `${side} TEAM`, exact: true });
    await dialog.getByRole("button", { name: "전체", exact: true }).click();
    await dialog.getByRole("searchbox", { name: "팀 이름 검색", exact: true }).fill("Gen.G");
    await dialog.locator(".team-choice-grid button").filter({ has: page.locator("strong").filter({ hasText: /^Gen\.G$/ }) }).click();
    await expect(dialog).not.toBeVisible();
  }
  await selectGenG("BLUE");
  await selectGenG("RED");
  const blue = page.getByRole("button", { name: /^BLUE TEAM:/ });
  const red = page.getByRole("button", { name: /^RED TEAM:/ });
  const blueName = await blue.locator("strong").textContent();
  const redName = await red.locator("strong").textContent();
  expect(blueName).not.toBe(redName);
  await page.getByRole("button", { name: "블루와 레드 팀 교체", exact: true }).click();
  await expect(blue.locator("strong")).toHaveText(redName);
  await expect(red.locator("strong")).toHaveText(blueName);
  await page.locator(".draft-first-selection select").selectOption("RED");
  await expect(page.locator(".draft-current-turn h2")).toContainText("레드 차례");
  await choose(page);
  await expect(blue).toBeDisabled();
  await expect(red).toBeDisabled();
  await expect(page.getByRole("button", { name: "블루와 레드 팀 교체", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "선택 취소", exact: true }).click();
  await expect(blue).toBeEnabled();
});
