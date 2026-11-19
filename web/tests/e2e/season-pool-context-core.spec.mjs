import { test, expect } from "@playwright/test";
import { showPanel } from "./studio-panels.mjs";

test("2015 MaRin pool reflects a current ban without treating historical counts as current strength", async ({ page }, testInfo) => {
  await page.goto("/pro-meta-intelligence/");
  await expect(page.getByRole("button", { name: "밴픽 링크 복사", exact: true })).toBeEnabled();
  await page.locator("#draft-search").fill("Maokai");
  await page.locator(".draft-picker-grid").getByRole("button", { name: "마오카이", exact: true }).click();
  await page.locator(".draft-lock-in").getByRole("button", { name: "밴 확정", exact: true }).click();
  await showPanel(page, "ROSTER");
  const season = page.locator("details.season-lineup");
  await season.locator(":scope > summary").click();
  await season.getByRole("button", { name: "시즌 선수 자료 불러오기", exact: true }).click();
  await season.getByLabel("선수 시즌", { exact: true }).selectOption("2015");
  const top = season.getByLabel("BLUE 탑 시즌 선수", { exact: true });
  const marin = await top.locator("option").evaluateAll(options => options.find(o => o.textContent.includes("2015 MaRin"))?.value);
  expect(marin).toBeTruthy(); await top.selectOption(marin);
  const card = top.locator("..").locator("..");
  await expect(card).toContainText("마오카이 30회(이번 판 밴)");
  await expect(card).toContainText("럼블 28회(이번 밴픽 미사용)");
  const remaining = card.locator("small").filter({ hasText: "이번 밴픽 미사용 관측 기록:" });
  await expect(remaining).toContainText("럼블 28회");
  await expect(remaining).not.toContainText("마오카이");
  await expect(page.locator(".draft-turn-progress")).toHaveAttribute("value", "1");
  await card.screenshot({ path: testInfo.outputPath("marin-2015-pool.png") });
});
