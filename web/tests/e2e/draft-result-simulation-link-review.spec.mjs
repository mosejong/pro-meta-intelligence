import { test, expect } from "@playwright/test";
import { enterDraftWorkspace, showPanel, studioTab } from "./studio-panels.mjs";

const root = "/pro-meta-intelligence/";
const progress = page => page.locator(".draft-turn-progress");
const result = page => page.getByRole("region", { name: "이번 밴픽 리포트", exact: true });
const ready = page => page.locator("details.simulation-readiness");

async function finish(page, automatic) {
  for (let n = 0; n < 35; n++) {
    const before = Number(await progress(page).getAttribute("value"));
    if (before === 20) return;
    const candidates = page.locator(".draft-picker-grid button:not(:disabled)");
    if (await candidates.count()) {
      await candidates.first().click();
      await page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ }).click();
    } else {
      expect(automatic).toBe(true);
    }
    await expect.poll(async () => Number(await progress(page).getAttribute("value"))).toBeGreaterThan(before);
  }
  throw new Error("Draft failed to complete within bounded interactions");
}

async function focusOnReadiness(page) {
  await expect(studioTab(page, "SIMULATION")).toHaveAttribute("aria-selected", "true");
  await expect(ready(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const target = document.querySelector(".simulation-readiness-team select:not(:disabled)")
      ?? document.querySelector(".simulation-readiness > summary");
    return document.activeElement === target;
  })).toBe(true);
}

for (const automatic of [false, true]) {
  test(`${automatic ? "solo" : "manual"} completion opens readiness with the same picks and never runs an experiment`, async ({ page }, info) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(root);
    await expect(page.getByRole("button", { name: "밴픽 시작", exact: true })).toBeEnabled({ timeout: 45_000 });
    if (automatic) await page.locator('.draft-flow-mode input[value="SOLO_BLUE"]').check();
    await enterDraftWorkspace(page);
    await expect(result(page)).toHaveCount(0);
    await finish(page, automatic);
    await expect(result(page)).toBeVisible();
    const names = {};
    for (const side of ["blue", "red"]) {
      names[side] = await result(page).locator(`.draft-result-teams > .${side} .draft-result-picks strong`).allTextContents();
      expect(names[side]).toHaveLength(5);
    }
    const actions = result(page).locator(".draft-result-actions button");
    await expect(actions).toHaveCount(4);
    for (const action of await actions.all()) {
      expect((await action.boundingBox()).height).toBeGreaterThanOrEqual(44);
    }
    await result(page).getByRole("button", { name: "가정 시뮬레이션 준비", exact: true }).click();
    await focusOnReadiness(page);
    for (const side of ["blue", "red"]) {
      const slots = ready(page).locator(`.simulation-readiness-team.${side} select`);
      await expect(slots).toHaveCount(5);
      for (const slot of await slots.all()) {
        const options = await slot.locator('option:not([value=""])').allTextContents();
        expect(options.sort()).toEqual([...names[side]].sort());
        await expect(slot).toHaveValue("");
      }
    }
    await expect(page.getByRole("region", { name: "가정 실험 재생", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "가정 실험 실행", exact: true })).toBeDisabled();
    await page.waitForTimeout(900);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("completed-draft-readiness.png") });
    await showPanel(page, "COMPARISON");
    await page.getByRole("button", { name: "현재 완료 드래프트를 기준 A로 고정", exact: true }).click();
    await page.locator("details.comparison-evidence > summary").click();
    await page.getByRole("button", { name: "시뮬레이션 준비 탭에서 역할 배정", exact: true }).click();
    await focusOnReadiness(page);
    await showPanel(page, "DRAFT");
    await expect(progress(page)).toHaveAttribute("value", "20");
    for (const side of ["blue", "red"]) {
      expect(await result(page).locator(`.draft-result-teams > .${side} .draft-result-picks strong`).allTextContents()).toEqual(names[side]);
    }
    expect(errors).toEqual([]);
  });
}
