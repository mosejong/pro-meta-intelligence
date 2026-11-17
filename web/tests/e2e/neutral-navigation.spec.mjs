import { test, expect } from "@playwright/test";

test("main navigation and old brief URL use team-neutral workspaces", async ({ page }) => {
  await page.goto("/pro-meta-intelligence/");
  await expect(page.getByRole("heading", { name: "모의 밴픽", exact: true })).toBeVisible();
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
  await expect(page.getByRole("link", { name: /T1 브리프|T1 简报/ })).toHaveCount(0);
  await expect(page.locator('a[href$="/t1/"]')).toHaveCount(0);
  const more = page.locator(".app-nav-more");
  if (await more.isVisible()) {
    await more.locator("summary").click();
    await expect(more.getByRole("link", { name: "팀 분석", exact: true })).toBeVisible();
    await expect(more.getByRole("link", { name: /T1/ })).toHaveCount(0);
  }
  const names = await page.locator(".draft-match-setup .team-chooser-trigger strong").allTextContents();
  expect(names).toHaveLength(2);
  expect(names[0]).not.toBe(names[1]);
  await page.getByRole("combobox", { name: "언어", exact: true }).selectOption("zh-CN");
  await expect(page.getByRole("heading", { name: "模拟禁选", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /T1 브리프|T1 简报/ })).toHaveCount(0);
  await expect(page.locator(".draft-match-setup .team-chooser-trigger strong")).toHaveText(names);
  await page.reload();
  await expect(page.getByRole("heading", { name: "模拟禁选", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "语言", exact: true }).selectOption("ko");
  // T1 remains an ordinary selectable team; no assertion forbids its data from appearing.
  await page.goto("/pro-meta-intelligence/t1/");
  await expect(page.getByRole("heading", { name: "내 팀 기준으로 결정하세요.", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /T1 브리프|T1 简报/ })).toHaveCount(0);
  await expect(page.getByText("T1 공략 준비실", { exact: true })).toHaveCount(0);
});
