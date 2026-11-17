import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { showPanel } from "./studio-panels.mjs";

const ROLES = ["TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT"];
const history = JSON.parse(readFileSync(new URL("../../public/history/player-season-2026.json", import.meta.url), "utf8"));
const normalize = value => {
  const key = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return ({ wukong: "monkeyking", renataglasc: "renata" })[key] ?? key;
};

test("actual annual data reproduces both sides of a role-change comparison", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/pro-meta-intelligence/draft/");
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
  for (let turn = 1; turn <= 20; turn++) {
    await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
    await page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ }).click();
    await expect(page.locator(".draft-turn-progress")).toHaveAttribute("value", String(turn));
  }
  await showPanel(page, "ROSTER");
  const roster = page.locator(".roster-workshop");
  if ((await roster.getAttribute("open")) === null) await roster.locator("> summary").click();
  const rosterSlot = (side, role) => page.locator(`.roster-team.${side} li[data-role="${role}"] select`);
  const used = new Set();
  const players = {};
  for (const side of ["blue", "red"]) for (const role of ROLES) {
    let value = await rosterSlot(side, role).inputValue();
    if (!value) {
      const options = await rosterSlot(side, role).locator("option").evaluateAll(nodes => nodes.map(n => n.value).filter(Boolean));
      value = options.find(v => !used.has(JSON.parse(v)[1]));
      expect(value).toBeTruthy();
      await rosterSlot(side, role).selectOption(value);
    }
    used.add(JSON.parse(value)[1]);
    players[`${side}.${role}`] = value;
  }
  await showPanel(page, "SIMULATION");
  const roleSlot = (side, role) => page.locator(`.simulation-readiness-team.${side} li[data-role="${role}"] select`);
  const champions = {};
  for (const side of ["blue", "red"]) for (const [i, role] of ROLES.entries()) {
    await roleSlot(side, role).selectOption({ index: i + 1 });
    champions[`${side}.${role}`] = await roleSlot(side, role).inputValue();
  }
  await showPanel(page, "COMPARISON");
  const comparison = page.getByRole("region", { name: "드래프트 A/B 비교", exact: true });
  await expect(comparison.locator("[data-current-roles]")).toHaveAttribute("data-current-roles", "recorded");
  await comparison.getByRole("button", { name: "현재 완료 드래프트를 기준 A로 고정", exact: true }).click();
  await showPanel(page, "SIMULATION");
  await roleSlot("blue", "TOP").selectOption(champions["blue.JUNGLE"]);
  await roleSlot("blue", "JUNGLE").selectOption(champions["blue.TOP"]);
  await showPanel(page, "COMPARISON");
  await expect(comparison.locator(':scope > .draft-comparison-body [data-role-diff="changed"]')).toBeVisible();
  const evidence = comparison.locator("details.comparison-evidence");
  await evidence.locator("> summary").click();
  await expect(evidence.locator(".comparison-evidence-source")).toContainText(`원본 제외 ${history.import_summary.rejected_game_count}경기`);
  const locked = new Set(Object.values(champions).map(normalize));
  for (const role of ["TOP", "JUNGLE"]) {
    const [sourceTeam, playerId] = JSON.parse(players[`blue.${role}`]);
    const player = history.players.find(p => p.team_id === sourceTeam && p.player_id === playerId);
    const record = player?.roles[role];
    expect(record).toBeTruthy();
    const card = evidence.locator(`.comparison-evidence-card[data-role="${role}"][data-changed="true"]`);
    await expect(card).toHaveCount(1);
    for (const side of ["A", "B"]) {
      const champion = champions[`blue.${side === "A" ? role : role === "TOP" ? "JUNGLE" : "TOP"}`];
      const view = card.locator(`[data-side="${side}"]`);
      for (const scope of ["season", "recent", "patch"]) {
        const stats = record[scope];
        const picks = stats.champions.find(c => normalize(c.champion_id) === normalize(champion))?.games ?? 0;
        await expect(view.locator(`[data-scope="${scope}"]`)).toHaveAttribute("data-games", String(stats.games));
        await expect(view.locator(`[data-scope="${scope}"]`)).toHaveAttribute("data-picks", String(picks));
      }
      const available = record.season.champions.filter(c => !locked.has(normalize(c.champion_id))).length;
      await expect(view.locator(".comparison-evidence-pool")).toHaveAttribute("data-available", String(available));
      await expect(view.locator(".comparison-evidence-pool")).toHaveAttribute("data-observed", String(record.season.champions.length));
    }
  }
  await expect(page.locator(".draft-turn-progress")).toHaveAttribute("value", "20");
  const widths = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  expect(widths[0]).toBeLessThanOrEqual(widths[1]);
  await evidence.screenshot({ path: testInfo.outputPath("real-ab-evidence.png") });
  expect(errors).toEqual([]);
});
