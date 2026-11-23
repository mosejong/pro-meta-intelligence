import { test, expect } from "@playwright/test";
import { enterDraftForReview } from "./enter-draft-review.mjs";
const root = "/pro-meta-intelligence/";
const progress = page => page.locator(".draft-turn-progress");
const recap = page => page.locator("details.draft-series-recap");
const games = page => recap(page).locator(".draft-series-recap-game");
const available = page => page.locator(".draft-picker-grid button:not(:disabled)");
const confirm = page => page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ });
async function ready(page) { await enterDraftForReview(page); }
async function pick(page) {
  const before = Number(await progress(page).getAttribute("value"));
  await available(page).first().click(); await confirm(page).click();
  await expect(progress(page)).toHaveAttribute("value", String(before + 1));
}
async function complete(page) { while (Number(await progress(page).getAttribute("value")) < 20) await pick(page); }
/** Team names per recap game as [blue, red], read from the rendered recap. */
async function recapTeams(page) {
  return games(page).evaluateAll(items => items.map(item => [...item.querySelectorAll("article h4")].map(h => h.lastChild.textContent.trim())));
}
async function savedGames(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const opening = indexedDB.open("pro-meta-draft", 1);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const reading = db.transaction("sessions").objectStore("sessions").get("current");
      reading.onerror = () => { db.close(); reject(reading.error); };
      reading.onsuccess = () => { db.close(); resolve(reading.result ? JSON.parse(reading.result).previous_games.length : null); };
    };
  }));
}
async function noHorizontalOverflow(page) {
  return page.evaluate(() => {
    const panel = document.querySelector("details.draft-series-recap");
    return document.documentElement.scrollWidth <= document.documentElement.clientWidth && panel.scrollWidth <= panel.clientWidth;
  });
}

test("여러 세트 복기는 완료 세트만 고정된 팀으로 보여주고 다음 세트·교체·새로고침·이전 세트 수정 후에도 유지된다", async ({ page }, testInfo) => {
  await page.goto(root); await ready(page);
  await expect(recap(page)).toHaveCount(0);
  await complete(page);
  await expect(recap(page)).toBeVisible();
  await expect(recap(page)).not.toHaveAttribute("open", "");
  await expect(recap(page).locator("summary")).toHaveText("여러 세트 복기 · 1세트");
  await expect(games(page)).toHaveCount(1);
  await expect(games(page).first().locator("h3")).toHaveText("1세트 · 방금 완료");
  const game1 = (await recapTeams(page))[0];
  expect(game1).toHaveLength(2);

  await page.getByRole("region", { name: "이번 밴픽 리포트", exact: true }).getByRole("button", { name: "피어리스 다음 세트", exact: true }).click();
  await expect(progress(page)).toHaveAttribute("value", "0");
  await expect(games(page)).toHaveCount(1);
  await expect(games(page).first().locator("h3")).toHaveText("1세트");

  // Swap sides for game 2: game 1 must keep its historic blue/red teams.
  // Sides are swapped on the team-selection step (current flow), then the draft continues.
  await page.getByRole("button", { name: "팀 선택으로", exact: true }).click();
  await page.getByRole("button", { name: "블루와 레드 팀 교체", exact: true }).click();
  await ready(page);
  expect((await recapTeams(page))[0]).toEqual(game1);
  await pick(page);
  await expect(games(page)).toHaveCount(1); // in-progress game is not a finished set
  await complete(page);
  await expect(games(page)).toHaveCount(2);
  const afterTwo = await recapTeams(page);
  expect(afterTwo).toEqual([game1, [game1[1], game1[0]]]);
  await page.getByRole("region", { name: "이번 밴픽 리포트", exact: true }).getByRole("button", { name: "피어리스 다음 세트", exact: true }).click();
  await expect(progress(page)).toHaveAttribute("value", "0");
  await expect(games(page)).toHaveCount(2);

  await expect.poll(() => savedGames(page)).toBe(2);
  await page.reload(); await ready(page);
  await expect(games(page)).toHaveCount(2);
  expect(await recapTeams(page)).toEqual(afterTwo);
  await expect(recap(page)).not.toHaveAttribute("open", "");

  await page.locator("details.draft-session-details > summary").click();
  await page.getByRole("button", { name: "이전 세트 수정", exact: true }).click();
  await expect(progress(page)).toHaveAttribute("value", "20");
  await expect(games(page)).toHaveCount(2); // reopened game counted exactly once, as current
  await expect(games(page).nth(1).locator("h3")).toHaveText("2세트 · 방금 완료");
  expect(await recapTeams(page)).toEqual(afterTwo);

  await recap(page).locator("summary").click();
  await expect(recap(page)).toHaveAttribute("open", "");
  // Read-only review: the only control is the later-added explicit text copy.
  const controls = recap(page).locator("button, input, select, textarea, a[href]");
  await expect(controls).toHaveCount(1);
  await expect(controls).toHaveText("여러 세트 밴픽 복사");
  await expect(recap(page)).toContainText("다음 세트부터 잠기는 픽");
  await expect(recap(page).getByText(/승률 \d|승리 확률|예측 승자|점수/)).toHaveCount(0);
  await expect(recap(page).getByText("확인하지 못함")).toHaveCount(0); // every finished set verified
  await expect(recap(page).locator("[role=status]")).toHaveText(""); // only the idle copy status line
  expect(await noHorizontalOverflow(page)).toBe(true);
  await recap(page).screenshot({ path: testInfo.outputPath("series-recap-open.png") });
});
