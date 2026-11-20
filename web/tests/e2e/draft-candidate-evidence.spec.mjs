import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { showPanel } from "./studio-panels.mjs";

test("candidate evidence stays in details and never confirms or restricts a pick", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/pro-meta-intelligence/");
  const progress = page.locator(".draft-turn-progress");
  const picker = page.locator(".draft-picker-grid button:not(:disabled)");
  await expect(picker.first()).toBeEnabled();
  await picker.first().click();
  await expect(progress).toHaveAttribute("value", "0");
  await showPanel(page, "DETAILS");
  const evidence = page.getByRole("region", { name: "픽 검토 근거", exact: true });
  await expect(evidence).toBeVisible();
  await expect(evidence.locator("[data-candidate-category]")).toHaveCount(2);
  await expect(evidence).toContainText("팀·현재 관측 선수 기록");
  await expect(evidence).toContainText("시즌 사용 기록");
  for (const category of await evidence.locator("[data-candidate-category]").evaluateAll(items => items.map(item => item.dataset.candidateCategory))) {
    expect(["META", "OFF_META", "EXPLORATORY"]).toContain(category);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await evidence.screenshot({ path: testInfo.outputPath("candidate-evidence.png") });
  await showPanel(page, "DRAFT");
  const confirm = page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ });
  await expect(confirm).toBeEnabled(); await confirm.click();
  await expect(progress).toHaveAttribute("value", "1");
  expect(errors).toEqual([]);
});


test("matching season companion is actually loaded and labels a current player's observed pick", async ({ page }) => {
  const report = JSON.parse(await readFile(new URL("../../public/feed/current.json", import.meta.url), "utf8"));
  const season = JSON.parse(await readFile(new URL("../../public/history/player-season-2026.json", import.meta.url), "utf8"));
  expect(season.cutoff).toBe(report.cutoff);
  await page.goto("/pro-meta-intelligence/");
  await expect(page.getByRole("button", { name: "밴픽 링크 복사", exact: true })).toBeEnabled();
  const name = await page.locator(".draft-team-column.blue header h2").textContent();
  const team = report.opponent_prep.teams.find(team => team.team_name === name); expect(team).toBeTruthy();
  const known = ["Ahri", "Akali", "Syndra", "Orianna", "Gnar", "Leona", "Rumble", "Aurora", "Nautilus", "Alistar"];
  const champions = (team.player_profiles ?? []).filter(profile => profile.roster_status === "CURRENT").flatMap(profile => {
    const player = season.players.find(player => player.team_id === team.team_id && player.player_id === profile.player_id && player.status === "FOUND");
    const role = profile.role === "ADC" ? "BOTTOM" : profile.role;
    return player?.roles?.[role]?.season?.champions.map(champion => champion.champion_id) ?? [];
  });
  const id = known.find(id => champions.includes(id)); expect(id).toBeTruthy();
  await page.locator(`.draft-picker-grid button:not(:disabled):has(img[src$="/${id}.png"])`).click();
  await showPanel(page, "DETAILS");
  const evidence = page.getByRole("region", { name: "픽 검토 근거", exact: true });
  const teamCard = evidence.locator("[data-candidate-category]").filter({ hasText: name });
  await expect(teamCard).toContainText("시즌 사용 기록 확인");
  await expect(page.locator(".draft-turn-progress")).toHaveAttribute("value", "0");
});
