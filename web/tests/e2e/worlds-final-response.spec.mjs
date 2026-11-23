import { test, expect } from "@playwright/test";
import { enterDraftForReview } from "./enter-draft-review.mjs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
let vite, serialize, canonical, actual, reference, frozen, current, suggest, apply;
const root = "/pro-meta-intelligence/";
const progress = page => page.locator(".draft-turn-progress");
test.beforeAll(async () => {
  const web = new URL("../../", import.meta.url);
  vite = await createServer({ root: fileURLToPath(web), configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  const a = await vite.ssrLoadModule("/app/draft-agent.ts");
  const assets = await vite.ssrLoadModule("/app/champion-assets.ts");
  serialize = a.serializeDraftScenario; canonical = assets.championAssetId;
  apply = a.applyDraftSelection;
  suggest = (await vite.ssrLoadModule("/app/solo-draft.ts")).suggestSoloDraftTurn;
  reference = JSON.parse(await readFile(new URL("../fixtures/worlds-final-gen-blg-20261114.json", import.meta.url), "utf8"));
  frozen = JSON.parse(await readFile(new URL("../fixtures/eligible-feed-20261114.json", import.meta.url), "utf8"));
  current = JSON.parse(await readFile(new URL("../../public/feed/current.json", import.meta.url), "utf8"));
  const game = reference.games[0]; actual = [];
  for (const turn of a.draftSequence("BLUE")) {
    const key = `${turn.side.toLowerCase()}_${turn.kind === "BAN" ? "bans" : "picks"}`;
    actual = a.applyDraftSelection(actual, canonical(game[key][turn.slot - 1]));
  }
});
test.afterAll(async () => { await vite?.close(); });
async function setup(page, report) {
  const gen = report.opponent_prep.teams.find(t => t.team_name === "Gen.G");
  const blg = report.opponent_prep.teams.find(t => t.team_name === "Bilibili Gaming");
  await page.goto(root);
  await enterDraftForReview(page);
  await page.locator(".draft-session-details > summary").click();
  await page.locator('.draft-session-controls input[type="file"]').setInputFiles({ name: "final-game1-reference.json", mimeType: "application/json", buffer: Buffer.from(serialize(report, gen, blg, [])) });
  await expect(page.locator(".draft-team-column.blue h2")).toHaveText("Gen.G");
  await expect(page.locator(".draft-team-column.red h2")).toHaveText("Bilibili Gaming");
  await page.getByLabel("내 진영", { exact: true }).selectOption("BLUE");
  await page.getByRole("checkbox", { name: "상대 자동 밴픽", exact: true }).check();
}
async function genChoice(page, selection) {
  await expect(progress(page)).toHaveAttribute("value", String(selection.turn - 1));
  await page.locator("#draft-search").fill(selection.champion_id);
  const button = page.locator(".draft-picker-grid button").filter({ has: page.locator(`img[src$="/${selection.champion_id}.png"]`) });
  await button.click();
  await page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ }).click();
}
function expectedCase(report) {
  const blueTeam = report.opponent_prep.teams.find(t => t.team_name === "Gen.G"), redTeam = report.opponent_prep.teams.find(t => t.team_name === "Bilibili Gaming");
  let selections = [];
  for (const intent of actual) {
    if (intent.side === "BLUE") {
      const next = apply(selections, intent.champion_id);
      if (next === selections) return { selections, stop: intent };
      selections = next;
    } else {
      const choice = suggest({ report, blueTeam, redTeam, selections, previousPicks: [], firstPickSide: "BLUE", manualSide: "BLUE" });
      expect(choice).not.toBeNull(); selections = apply(selections, choice.champion_id);
    }
  }
  return { selections, stop: null };
}
async function playCase(page, report) {
  const expected = expectedCase(report);
  await setup(page, report);
  for (const selection of actual.filter(s => s.side === "BLUE" && s.turn <= expected.selections.length)) await genChoice(page, selection);
  await expect(progress(page)).toHaveAttribute("value", String(expected.selections.length));
  if (expected.stop) {
    await page.locator("#draft-search").fill(expected.stop.champion_id);
    await expect(page.locator(`.draft-picker-grid button img[src$="/${expected.stop.champion_id}.png"]`)).toHaveCount(0);
    await expect(page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ })).toBeDisabled();
  } else await expect(page.getByRole("region", { name: "이번 밴픽 리포트", exact: true })).toBeVisible();
  const ownPicks = expected.selections.filter(s => s.side === "BLUE" && s.kind === "PICK");
  const images = page.locator(".draft-team-column.blue .draft-pick-stack article.filled img");
  await expect(images).toHaveCount(ownPicks.length);
  // The pick stack is ordered by assigned position, not pick order: compare the shown champions as a set.
  const shown = (await images.evaluateAll(nodes => nodes.map(n => n.getAttribute("src").split("/").pop()))).sort();
  expect(shown).toEqual(ownPicks.map(p => `${p.champion_id}.png`).sort());
}
test("결승 전 자료에서 실제 젠지 선택을 가능한 지점까지 유지하며 BLG 반응을 확인한다", async ({ page }, testInfo) => {
  expect(Date.parse(frozen.cutoff)).toBeLessThan(Date.parse(reference.first_game_at));
  await playCase(page, frozen);
  await page.locator(".draft-stage").screenshot({ path: testInfo.outputPath("gen-actual-blg-auto-pre-final.png") });
});
test("현재 자료의 실제 반응을 따라가며 차단된 젠지 선택을 강제로 넣지 않는다", async ({ page }, testInfo) => {
  expect(Date.parse(current.cutoff)).toBeGreaterThan(Date.parse(reference.first_game_at));
  // Do not freeze today's Olaf choice as desirable behavior; the policy/data may improve later.
  await playCase(page, current);
  await page.locator(".draft-stage").screenshot({ path: testInfo.outputPath("gen-olaf-blocked-by-auto-blg.png") });
});
