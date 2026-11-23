import { test, expect } from "@playwright/test";
import { enterDraftForReview } from "./enter-draft-review.mjs";
import { readFile } from "node:fs/promises";
import { showPanel } from "./studio-panels.mjs";

const key = "pro-meta-guest-clubs-v1";
test("old Nuguri club survives catalog expansion and 2015 MaRin is selectable", async ({ page }) => {
  const old = JSON.parse(await readFile(new URL("../../public/history/catalogs/b0f5e81bc19120632147dec7913ffd2c772aa17e63590e8b5570392a4e04c304.json", import.meta.url), "utf8"));
  await page.route("**/history/season-player-cards.json", route => route.fulfill({ json: old }), { times: 1 });
  await page.goto("/pro-meta-intelligence/");
  await enterDraftForReview(page);
  const open = async () => {
    await showPanel(page, "ROSTER");
    const season = page.locator("details.season-lineup");
    if (await season.getAttribute("open") === null) await season.locator(":scope > summary").click();
    await season.getByRole("button", { name: "시즌 선수 자료 불러오기", exact: true }).click();
    await expect(season.getByLabel("선수 시즌", { exact: true })).toBeVisible();
    return season;
  };
  let season = await open();
  const nuguri = old.cards.find(c => c.season === 2022 && c.player_name === "Nuguri" && c.role === "TOP");
  await season.getByLabel("BLUE 탑 시즌 선수", { exact: true }).selectOption(nuguri.id);
  const club = page.locator(".guest-club");
  await club.getByLabel("구단 이름", { exact: true }).fill("이전 자료 너구리");
  await club.getByRole("button", { name: "새 구단으로 저장", exact: true }).click();
  await expect(club.getByRole("status")).toContainText("저장했습니다");
  const saved = await page.evaluate(key => localStorage.getItem(key), key);
  await page.reload();
  await enterDraftForReview(page);
  season = await open();
  const archive = page.waitForResponse(r => r.url().endsWith(`/history/catalogs/${old.catalog_id}.json`));
  await club.locator(".guest-club-list article").filter({ hasText: "이전 자료 너구리" }).getByRole("button", { name: "불러오기", exact: true }).click();
  await club.getByRole("button", { name: "불러오기 확정", exact: true }).click();
  expect((await archive).status()).toBe(200);
  await expect(club.getByRole("status")).toContainText("내용이 완전히 같은 시즌 카드");
  await expect(season.getByLabel("BLUE 탑 시즌 선수", { exact: true })).toHaveValue(nuguri.id);
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(saved);
  await season.getByLabel("선수 시즌", { exact: true }).selectOption("2015");
  const top = season.getByLabel("BLUE 탑 시즌 선수", { exact: true });
  const marin = await top.locator("option").evaluateAll(options => options.find(o => o.textContent.includes("2015 MaRin"))?.value);
  expect(marin).toBeTruthy();
  await top.selectOption(marin);
  await expect(top.locator("..").locator("..")).toContainText("2015 MaRin");
  await expect(top.locator("..").locator("..")).toContainText("114경기");
  const observed = season.getByLabel("관측 팀", { exact: true });
  const skt = await observed.locator("option").evaluateAll(options => options.find(o => o.textContent.includes("2015 SK Telecom T1"))?.value);
  expect(skt).toBeTruthy();
  await observed.selectOption(skt);
  const preset = season.getByRole("group", { name: "역할별 최다 출전 구성", exact: true });
  await preset.getByRole("button", { name: "BLUE에 적용", exact: true }).click();
  const expected = { 탑: "MaRin", 정글: "Bengi", 미드: "Faker", 바텀: "Bang", 서포터: "Wolf" };
  for (const [role, name] of Object.entries(expected)) {
    const select = season.getByLabel(`BLUE ${role} 시즌 선수`, { exact: true });
    await expect(select.locator("option:checked")).toContainText(name);
  }
  const snapshot = () => page.locator(".roster-workshop select").evaluateAll(selects => selects.map(s => [s.getAttribute("aria-label"), s.value]));
  const before = await snapshot();
  await preset.getByRole("button", { name: "RED에 적용", exact: true }).click();
  await expect(page.locator(".roster-workshop-status").filter({ hasText: "구성을 적용하지 않았습니다." })).toBeVisible();
  expect(await snapshot()).toEqual(before);

});
