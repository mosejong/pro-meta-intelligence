import { test, expect } from "@playwright/test";
import { showPanel } from "./studio-panels.mjs";
const root = "/pro-meta-intelligence/";
const progress = page => page.locator(".draft-turn-progress");
const solo = page => page.getByRole("region", { name: "혼자 밴픽 연습", exact: true });
const toggle = page => solo(page).getByRole("checkbox", { name: "상대 자동 밴픽", exact: true });
const available = page => page.locator(".draft-picker-grid button:not(:disabled)");
const confirm = page => page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ });
async function open(page, side = "BLUE") {
  await page.goto(root);
  await expect(page.getByRole("button", { name: "밴픽 링크 복사", exact: true })).toBeEnabled();
  await solo(page).getByLabel("내 진영", { exact: true }).selectOption(side);
  await toggle(page).check();
}
async function humanPick(page) {
  await expect(available(page).first()).toBeEnabled();
  await available(page).first().click(); await confirm(page).click();
}
async function savedTurns(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const opening = indexedDB.open("pro-meta-draft", 1);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const reading = db.transaction("sessions").objectStore("sessions").get("current");
      reading.onerror = () => { db.close(); reject(reading.error); };
      reading.onsuccess = () => { db.close(); resolve(reading.result ? JSON.parse(reading.result).selections.length : null); };
    };
  }));
}
async function complete(page) {
  for (let step = 0; step < 30; step++) {
    const before = Number(await progress(page).getAttribute("value"));
    if (before === 20) return;
    if (await available(page).count()) await humanPick(page);
    else await expect.poll(async () => Number(await progress(page).getAttribute("value"))).toBeGreaterThan(before);
  }
  throw new Error("Draft did not complete within bounded interactions");
}
test("블루 혼자 연습은 상대를 자동 진행하고 되돌리기·리포트·피어리스를 연결한다", async ({ page }, testInfo) => {
  await open(page);
  await expect(progress(page)).toHaveAttribute("value", "0");
  await humanPick(page);
  await expect(progress(page)).toHaveAttribute("value", "2");
  await page.getByRole("button", { name: "내 마지막 선택 되돌리기", exact: true }).click();
  await expect(progress(page)).toHaveAttribute("value", "0");
  await expect(page.getByRole("region", { name: "이번 밴픽 리포트", exact: true })).toHaveCount(0);
  await complete(page);
  const result = page.getByRole("region", { name: "이번 밴픽 리포트", exact: true });
  await expect(result).toBeVisible();
  await expect(result.locator(".draft-result-picks li")).toHaveCount(10);
  await expect(result).toContainText("경기 승패·시너지·상성은 계산하지 않습니다.");
  await expect(result.getByText(/승률 \d|승리 확률|예측 승자/)).toHaveCount(0);
  await expect(result.locator("h2")).toBeInViewport();
  if (testInfo.project.name === "mobile-width") await expect.poll(() => page.evaluate(() => {
    const heading = document.querySelector(".draft-result h2").getBoundingClientRect();
    const rail = document.querySelector(".studio-tabs").getBoundingClientRect();
    return heading.top >= rail.bottom;
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("solo-draft-result.png") });
  await result.getByRole("button", { name: "같은 팀으로 다시 도전", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "현재 세트를 초기화할까요?", exact: true });
  await dialog.getByRole("button", { name: "계속 분석하기", exact: true }).click();
  await expect(progress(page)).toHaveAttribute("value", "20");
  await result.getByRole("button", { name: "피어리스 다음 세트", exact: true }).click();
  await expect(progress(page)).toHaveAttribute("value", "0");
  await expect(page.locator(".draft-series-locks > span")).toHaveCount(10);
  await expect(toggle(page)).toBeChecked();
  await expect(result).toHaveCount(0);
});
test("레드 혼자 연습은 첫 상대 차례부터 시작하고 새로고침은 수동 모드로 복원한다", async ({ page }) => {
  await open(page, "RED");
  await expect(progress(page)).toHaveAttribute("value", "1");
  await expect(available(page).first()).toBeEnabled();
  await expect.poll(() => savedTurns(page)).toBe(1);
  await page.reload();
  await expect(page.getByRole("button", { name: "밴픽 링크 복사", exact: true })).toBeEnabled();
  await expect(progress(page)).toHaveAttribute("value", "1");
  await expect(toggle(page)).not.toBeChecked();
  await solo(page).getByLabel("내 진영", { exact: true }).selectOption("RED");
  await toggle(page).check(); await complete(page);
  await expect(page.locator(".draft-result-picks li")).toHaveCount(10);
});
test("다른 탭에서는 자동 진행을 멈추고 밴픽 탭으로 돌아오면 이어간다", async ({ page }) => {
  await open(page, "RED");
  await showPanel(page, "ROSTER");
  const held = await progress(page).getAttribute("value");
  await page.waitForTimeout(900); // Covers the 600ms auto-turn deadline while the panel is hidden.
  await expect(progress(page)).toHaveAttribute("value", held);
  await showPanel(page, "DRAFT");
  await expect(progress(page)).toHaveAttribute("value", "1");
  await toggle(page).uncheck(); await humanPick(page);
  await expect(progress(page)).toHaveAttribute("value", "2");
  await page.waitForTimeout(900);
  await expect(progress(page)).toHaveAttribute("value", "2");
});
