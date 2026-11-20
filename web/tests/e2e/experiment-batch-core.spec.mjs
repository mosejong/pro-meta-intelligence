import { test, expect } from "@playwright/test";
import { enterDraftWorkspace, showPanel } from "./studio-panels.mjs";

const root = "/pro-meta-intelligence/";
const ROLES = ["TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT"];
const progress = (page) => page.locator(".draft-turn-progress");
const readiness = (page) => page.locator("details.simulation-readiness");
const roster = (page) => page.locator("details.roster-workshop");
const rosterSlot = (page, side, role) => page.locator(`.roster-team.${side} li[data-role="${role}"] select`);
const roleSlot = (page, side, role) => page.locator(`.simulation-readiness-team.${side} li[data-role="${role}"] select`);
const panel = (page) => page.locator("section.experiment-replay");

async function openDetails(locator) {
  if ((await locator.getAttribute("open")) === null) await locator.locator("> summary").click();
}

async function readyInput(page) {
  await page.goto(root);
  await enterDraftWorkspace(page);
  await expect(page.getByRole("heading", { name: "모의 밴픽", exact: true })).toBeVisible();
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
  await showPanel(page, "DRAFT");
  for (let i = 0; i < 20; i += 1) {
    await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
    await page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ }).click();
    await expect(progress(page)).toHaveAttribute("value", String(i + 1));
  }
  await showPanel(page, "ROSTER");
  await openDetails(roster(page));
  await expect(rosterSlot(page, "blue", "TOP")).toBeEnabled();
  for (const side of ["blue", "red"]) for (const role of ROLES) {
    if (await rosterSlot(page, side, role).inputValue()) continue;
    const used = [];
    for (const s of ["blue", "red"]) for (const r of ROLES) used.push(await rosterSlot(page, s, r).inputValue());
    const value = await rosterSlot(page, side, role).evaluate((select, taken) =>
      [...select.querySelectorAll("option")].map((o) => o.value).find((v) => v && !taken.includes(v)) ?? null, used.filter(Boolean));
    expect(value).not.toBeNull();
    await rosterSlot(page, side, role).selectOption(value);
  }
  await showPanel(page, "SIMULATION");
  await openDetails(readiness(page));
  for (const side of ["blue", "red"]) for (const [i, role] of ROLES.entries()) await roleSlot(page, side, role).selectOption({ index: i + 1 });
  await expect(readiness(page).getByRole("status").filter({ hasText: "입력 준비 완료" })).toBeVisible();
}

test("batch computes only explicitly, validates count and retains visibly stale results after B changes", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } }));
  await readyInput(page);
  const replay = panel(page);
  const run = replay.locator('button[type="submit"]');
  const inputs = replay.locator('.experiment-replay-team input[type="number"]');
  const slider = replay.locator('.experiment-replay-result .experiment-replay-seek input[type="range"]');
  await run.click();
  const compare = replay.locator("details.experiment-comparison");
  await openDetails(compare);
  await slider.focus(); await slider.press("End");
  await compare.getByRole("button", { name: "이 실행을 비교 기준 A로 보관" }).click();
  await inputs.nth(2).fill("0.35");
  await run.click();
  const batch = compare.getByRole("region", { name: "같은 밴픽의 여러 재현 번호 비교", exact: true });
  const compute = batch.getByRole("button", { name: "여러 재현 번호로 실행", exact: true });
  await expect(compute).toBeDisabled();
  await expect(batch.getByTestId("experiment-batch-result")).toHaveCount(0);
  await slider.focus(); await slider.press("End");
  await expect(compute).toBeEnabled();
  const count = batch.getByLabel("쌍 수", { exact: false });
  await count.fill("31"); await expect(compute).toBeDisabled();
  await count.fill("3"); await compute.click();
  const result = batch.getByTestId("experiment-batch-result");
  await expect(result).toContainText("3쌍");
  await expect(result).not.toHaveAttribute("data-stale");
  const before = await result.innerText();
  await count.fill("4");
  expect(await result.innerText()).toBe(before);
  await batch.getByRole("button", { name: "비교 요약을 쉬운 글로 복사", exact: true }).click();
  await expect(batch.getByLabel("비교 요약 (직접 복사)", { exact: true })).toHaveValue(/3쌍/);
  await inputs.nth(2).fill("0.7");
  await run.click();
  await expect(result).toHaveAttribute("data-stale", "true");
  await expect(batch.getByRole("alert")).toContainText("이전 대상");
  await expect(batch.getByRole("button", { name: "비교 요약을 쉬운 글로 복사", exact: true })).toBeDisabled();
  await expect(batch.getByLabel("비교 요약 (직접 복사)", { exact: true })).toHaveCount(0);
});
