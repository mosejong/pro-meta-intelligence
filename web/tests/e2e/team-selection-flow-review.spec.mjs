import { test, expect } from "@playwright/test";

const root = "/pro-meta-intelligence/";
const setup = page => page.locator(".draft-match-setup");
const progress = page => page.locator(".draft-turn-progress");

test("teams first; start, back cancels pending auto turn, continue and reload preserve play", async ({ page }, testInfo) => {
  await page.goto(root);
  const start = page.getByRole("button", { name: "밴픽 시작", exact: true });
  await expect(start).toBeEnabled();
  await expect(setup(page)).toBeVisible();
  await expect(page.getByRole("tablist", { name: "작업실 보기", exact: true })).toBeHidden();
  await expect(page.locator(".draft-picker-grid")).toBeHidden();
  await expect(page.locator(".draft-lock-in")).toBeHidden();
  await page.getByRole("button", { name: /^BLUE TEAM:/ }).click();
  const dialog = page.getByRole("dialog", { name: "BLUE TEAM", exact: true });
  await dialog.getByRole("button", { name: "전체", exact: true }).click();
  const candidate = dialog.locator('.team-choice-grid button[aria-pressed="false"]').first();
  const team = await candidate.locator("strong").innerText();
  await candidate.click();
  await expect(page.getByRole("button", { name: /^BLUE TEAM:/ })).toContainText(team);
  expect((await start.boundingBox()).height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("team-selection-screen.png"), fullPage: true });
  await start.click();
  await expect(setup(page)).toBeHidden();
  await expect(page.getByRole("tablist", { name: "작업실 보기", exact: true })).toBeVisible();
  await expect(page.locator(".draft-stage")).toBeInViewport();
  expect(await page.evaluate(() => Boolean(document.querySelector(".draft-stage")
    .compareDocumentPosition(document.querySelector(".draft-share")) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(page.getByText(team, { exact: true }).filter({ visible: true }).first()).toBeVisible();
  const solo = page.getByRole("region", { name: "혼자 밴픽 연습", exact: true });
  await solo.getByLabel("내 진영", { exact: true }).selectOption("BLUE");
  await solo.getByRole("checkbox", { name: "상대 자동 밴픽", exact: true }).check();
  await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
  await page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ }).click();
  await page.getByRole("button", { name: "팀 선택으로", exact: true }).click();
  await expect(setup(page)).toBeVisible();
  await page.waitForTimeout(900); // exceeds the existing 600ms auto-choice timer: hidden play must stop
  await expect(progress(page)).toHaveAttribute("value", "1");
  await expect(page.getByRole("button", { name: /^BLUE TEAM:/ })).toBeDisabled();
  await page.getByRole("button", { name: "밴픽 이어가기", exact: true }).click();
  await expect(progress(page)).toHaveAttribute("value", "1");
  await solo.getByRole("checkbox", { name: "상대 자동 밴픽", exact: true }).uncheck();
  await solo.getByRole("checkbox", { name: "상대 자동 밴픽", exact: true }).check();
  await expect(progress(page)).toHaveAttribute("value", "2");
  await expect.poll(() => page.evaluate(() => new Promise((resolve, reject) => {
    const opening = indexedDB.open("pro-meta-draft", 1);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result, tx = db.transaction("sessions", "readonly");
      const request = tx.objectStore("sessions").get("current-solo-review");
      request.onsuccess = () => { db.close(); resolve(typeof request.result === "string" ? JSON.parse(request.result).records.length : 0); };
      request.onerror = () => { db.close(); reject(request.error); };
    };
  }))).toBe(1);
  await page.reload();
  await expect(page.locator(".draft-picker-grid")).toBeVisible();
  await expect(setup(page)).toBeHidden();
  await expect(progress(page)).toHaveAttribute("value", "2");
  await expect(solo.getByRole("checkbox", { name: "상대 자동 밴픽", exact: true })).not.toBeChecked();
  await expect(page.locator(".solo-history > summary")).toContainText("(1)");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("draft-second-screen.png"), fullPage: false });
});

test("save-failure shortcut opens the visible draft recovery panel from team selection", async ({ page }) => {
  await page.addInitScript(() => {
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      if (window.__failDraftSave && this.name === "sessions" && key === "current") {
        throw new DOMException("injected save failure", "QuotaExceededError");
      }
      return originalPut.call(this, value, key);
    };
  });
  await page.goto(root);
  await page.getByRole("button", { name: "밴픽 시작", exact: true }).click();
  await page.evaluate(() => { window.__failDraftSave = true; });
  await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
  await page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ }).click();
  await expect(page.locator(".studio-save-flag")).toBeVisible();
  await page.getByRole("button", { name: "팀 선택으로", exact: true }).click();
  await expect(setup(page)).toBeVisible();
  await page.locator(".studio-save-flag").click();
  await expect(setup(page)).toBeHidden();
  await expect(page.locator(".draft-save-failed")).toBeVisible();
});

test("a fresh shared-draft visitor reaches preview without starting or silently accepting", async ({ page, browser }, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", {
    configurable: true, value: { writeText: async () => { throw new Error("denied"); } },
  }));
  await page.goto(root);
  await page.getByRole("button", { name: "밴픽 시작", exact: true }).click();
  await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
  await page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ }).click();
  await page.getByRole("button", { name: "밴픽 링크 복사", exact: true }).click();
  const href = await page.getByLabel("복사할 밴픽 링크", { exact: true }).inputValue();
  const { viewport, isMobile, hasTouch } = testInfo.project.use;
  const context = await browser.newContext({ viewport, isMobile, hasTouch });
  try {
    const receiver = await context.newPage();
    await receiver.goto(href);
    const preview = receiver.getByRole("region", { name: "공유 밴픽 미리보기", exact: true });
    await expect(preview).toBeVisible();
    await expect(setup(receiver)).toBeHidden();
    await expect(progress(receiver)).toHaveAttribute("value", "0");
    expect(receiver.url()).toBe(href);
    await preview.getByRole("button", { name: "이 밴픽 불러오기", exact: true }).click();
    await expect(progress(receiver)).toHaveAttribute("value", "1");
  } finally { await context.close(); }
});
