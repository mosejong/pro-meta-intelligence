import { test, expect } from "@playwright/test";
import { enterDraftForReview } from "./enter-draft-review.mjs";

const root = "/pro-meta-intelligence/";
const progress = page => page.locator(".draft-turn-progress");
const preview = page => page.getByRole("region", { name: "공유 밴픽 미리보기", exact: true });
const confirm = page => page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ });
async function ready(page) {
  await enterDraftForReview(page);
}
async function commit(page, count) {
  for (let i = 0; i < count; i++) {
    await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
    await confirm(page).click();
  }
}
async function clipboard(page, deny = false) {
  await page.addInitScript(deny => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async value => {
      if (deny) throw new Error("clipboard denied");
      window.__sharedDraftLink = value;
    } } });
  }, deny);
}
async function copy(page) {
  await page.getByRole("button", { name: "밴픽 링크 복사", exact: true }).click();
  await expect(page.getByText("밴픽 링크를 복사했습니다.", { exact: true })).toBeVisible();
  return page.evaluate(() => window.__sharedDraftLink);
}
async function stored(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("pro-meta-draft", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction("sessions").objectStore("sessions").get("current");
      read.onsuccess = () => { db.close(); resolve(read.result ? JSON.parse(read.result) : null); };
      read.onerror = () => { db.close(); reject(read.error); };
    };
  }));
}

test("copy to a fresh context previews; cancel preserves stored work; explicit load restores draft and stage", async ({ page, browser }, testInfo) => {
  await clipboard(page);
  await page.goto(root); await ready(page);
  await commit(page, 3);
  await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
  const stage = await page.locator(".draft-lock-in > div > span").textContent();
  const url = await copy(page);
  expect(new URL(url).search).toBe("");
  expect(new URL(url).pathname).toBe(root);
  const context = await browser.newContext({ viewport: page.viewportSize() });
  try {
    const recipient = await context.newPage();
    await recipient.goto(url); await ready(recipient);
    await expect(preview(recipient)).toBeVisible();
    await expect(progress(recipient)).toHaveAttribute("value", "0");
    await expect(preview(recipient)).toContainText("확정 3개");
    await expect(preview(recipient).getByRole("button", { name: "이 밴픽 불러오기", exact: true })).toBeInViewport();
    expect(await recipient.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await recipient.screenshot({ path: testInfo.outputPath("share-preview.png"), fullPage: false });
    await preview(recipient).getByRole("button", { name: "취소", exact: true }).click();
    await expect(preview(recipient)).toHaveCount(0);
    await commit(recipient, 1);
    await expect.poll(async () => (await stored(recipient))?.selections.length).toBe(1);
    const before = await stored(recipient);
    // Same-fragment navigation need not reload Chromium; explicitly test a fresh visit.
    await recipient.goto(url); await recipient.reload(); await ready(recipient);
    await expect(preview(recipient)).toBeVisible();
    await expect(progress(recipient)).toHaveAttribute("value", "1");
    await preview(recipient).getByRole("button", { name: "취소", exact: true }).click();
    expect(await stored(recipient)).toEqual(before);
    await recipient.reload(); await ready(recipient);
    await expect(preview(recipient)).toBeVisible();
    await preview(recipient).getByRole("button", { name: "이 밴픽 불러오기", exact: true }).click();
    await expect(progress(recipient)).toHaveAttribute("value", "3");
    await expect(recipient.locator(".draft-lock-in > div > span")).toHaveText(stage);
    await expect.poll(async () => (await stored(recipient))?.selections.length).toBe(3);
    expect((await stored(recipient)).selections).toEqual((await stored(page)).selections);
  } finally { await context.close(); }
});

test("clipboard denial provides a selectable input and clears stale feedback on edit", async ({ page }) => {
  await clipboard(page, true);
  await page.goto(root); await ready(page);
  await page.getByRole("button", { name: "밴픽 링크 복사", exact: true }).click();
  const field = page.getByRole("textbox", { name: "복사할 밴픽 링크", exact: true });
  await expect(field).toBeVisible();
  await expect(field).toHaveValue(/#draft=[A-Za-z0-9_-]+$/);
  await field.focus();
  expect(await field.evaluate(input => input.selectionEnd - input.selectionStart)).toBe((await field.inputValue()).length);
  await commit(page, 1);
  await expect(field).toHaveCount(0);
});

test("invalid incoming link leaves the main draft usable", async ({ page }) => {
  await page.goto(root + "#draft=invalid_"); await ready(page);
  await expect(preview(page).getByRole("alert")).toBeVisible();
  await expect(preview(page).getByRole("button", { name: "이 밴픽 불러오기", exact: true })).toHaveCount(0);
  await preview(page).getByRole("button", { name: "취소", exact: true }).click();
  await commit(page, 1);
  await expect(progress(page)).toHaveAttribute("value", "1");
});

test("late clipboard completion never labels a newer draft as copied", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: () => new Promise(resolve => { window.__finishDraftCopy = resolve; }),
  } }));
  await page.goto(root); await ready(page);
  await page.getByRole("button", { name: "밴픽 링크 복사", exact: true }).click();
  await commit(page, 1);
  await page.evaluate(() => window.__finishDraftCopy());
  await expect(page.getByText("밴픽 링크를 복사했습니다.", { exact: true })).toHaveCount(0);
});
