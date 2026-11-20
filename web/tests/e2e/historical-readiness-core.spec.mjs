import { test, expect } from "@playwright/test";
import { showPanel } from "./studio-panels.mjs";

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

test("past-season assignment blocks experiment input clearly and current-player restore re-enables readiness", async ({ page }) => {
  await readyInput(page);
  const run = panel(page).locator('button[type="submit"]');
  await expect(run).toBeEnabled();
  await showPanel(page, "ROSTER");
  const currentTop = rosterSlot(page, "blue", "TOP");
  const original = await currentTop.inputValue();
  expect(original).toBeTruthy();
  const season = page.locator("details.season-lineup");
  await openDetails(season);
  await season.getByRole("button", { name: "시즌 선수 자료 불러오기", exact: true }).click();
  await season.getByLabel("선수 시즌", { exact: true }).selectOption("2015");
  const historical = season.getByLabel("BLUE 탑 시즌 선수", { exact: true });
  const marin = await historical.locator("option").evaluateAll(options => options.find(o => o.textContent.includes("2015 MaRin"))?.value);
  expect(marin).toBeTruthy(); await historical.selectOption(marin);
  await showPanel(page, "SIMULATION");
  await expect(readiness(page)).toContainText("과거 시즌 선수가 선수 구성에 있어 가정 실험 입력을 만들지 않습니다");
  await expect(run).toBeDisabled();
  await expect(readiness(page).getByRole("button", { name: "준비된 입력 고정", exact: true })).toBeDisabled();
  await readiness(page).getByRole("button", { name: "선수 구성 확인", exact: true }).click();
  await expect(historical).toHaveValue(marin);
  await currentTop.selectOption(original);
  await expect(historical).toHaveValue("");
  await showPanel(page, "SIMULATION");
  await expect(readiness(page).getByRole("status").filter({ hasText: "입력 준비 완료" })).toBeVisible();
  await expect(run).toBeEnabled();
});
