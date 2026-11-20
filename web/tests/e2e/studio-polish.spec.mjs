import { test, expect } from "@playwright/test";
import { enterDraftWorkspace } from "./studio-panels.mjs";

const root = "/pro-meta-intelligence/";
const header = page => page.locator("header.workspace-header");

test("Velkoz and Belveth use the actual official portrait files", async ({ page }, testInfo) => {
  await page.goto(root);
  await enterDraftWorkspace(page);
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
  for (const id of ["Velkoz", "Belveth"]) {
    await page.locator("#draft-search").fill(id);
    const portrait = page.locator(`.draft-picker-grid img[src$="/${id}.png"]`);
    await expect(portrait).toHaveCount(1);
    await expect(portrait).toBeVisible();
    await expect.poll(() => portrait.evaluate(image => image.complete && image.naturalWidth > 0), { timeout: 25_000 }).toBe(true);
    if (id === "Velkoz") await page.locator(".draft-picker").screenshot({ path: testInfo.outputPath("velkoz-fixed.png") });
  }
});

test("main navigation stays simple and research routes share the charcoal header", async ({ page }, testInfo) => {
  await page.goto(root);
  await enterDraftWorkspace(page);
  await expect(header(page)).toBeVisible();
  await expect(header(page).getByRole("link", { name: "모의 밴픽", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(header(page).locator(".workspace-resources")).not.toHaveAttribute("open", "");
  await expect(header(page).getByRole("link", { name: "팀 분석", exact: true })).not.toBeVisible();
  await header(page).locator(".workspace-resources > summary").click();
  await expect(header(page).locator(".workspace-resource-menu")).toBeVisible();
  if (await page.locator(".app-bottom-navigation").isVisible()) {
    await expect(page.locator(".app-bottom-navigation")).toHaveCSS("background-color", "rgb(17, 18, 20)");
  }
  await expectNoOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("studio-menu.png"), fullPage: false });
  await header(page).getByRole("link", { name: "팀 분석", exact: true }).click();
  await expect(page).toHaveURL(/\/team\/$/);
  await expect(header(page)).toHaveCSS("background-color", "rgb(17, 18, 20)");
  await expect(page.locator("main.legacy-workspace")).toHaveCSS("background-color", "rgb(17, 18, 20)");
  await expect(header(page).getByRole("button", { name: /자료 파일 불러오기/ })).not.toBeVisible();
  await expectNoOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("team-neutral-shell.png"), fullPage: false });
  await header(page).getByRole("link", { name: "모의 밴픽", exact: true }).click();
  await expect(page).toHaveURL(/\/draft\/$/);
  await enterDraftWorkspace(page);
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
  await expectNoOverflow(page);
});

async function expectNoOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
}
