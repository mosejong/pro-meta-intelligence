import { test, expect } from "@playwright/test";
import { enterDraftForReview } from "./enter-draft-review.mjs";
import { showPanel } from "./studio-panels.mjs";

const p = page => page.locator("section.experiment-replay");
const c = page => p(page).locator("details.experiment-comparison");
const inputs = page => p(page).locator('.experiment-replay-team input[type="number"]');
const seed = page => p(page).getByLabel("재현 번호 (시드)", { exact: true });
const run = page => p(page).locator('button[type="submit"]');
const slider = page => p(page).locator('.experiment-replay-seek input[type="range"]');
const load = page => c(page).getByRole("button", { name: "기준 A의 가정값 불러오기", exact: true });
async function open(item) { if (await item.getAttribute("open") === null) await item.locator(":scope > summary").click(); }
async function end(page) { await slider(page).focus(); await slider(page).press("End"); }
async function start(page) {
  await page.goto("/pro-meta-intelligence/");
  await enterDraftForReview(page);
  await expect(page.getByRole("button", { name: "밴픽 링크 복사", exact: true })).toBeEnabled();
  await showPanel(page, "SIMULATION");
  const example = page.locator("details.simulation-example"); await open(example);
  await example.getByRole("button", { name: "이 예시로 입력 준비", exact: true }).click();
  await seed(page).fill("4242"); await inputs(page).first().fill("0.0000001");
  await run(page).click(); await end(page); await open(c(page));
  await c(page).getByRole("button", { name: "이 실행을 비교 기준 A로 보관", exact: true }).click();
}
const stats = page => p(page).locator('.experiment-replay-states [data-stat]').allTextContents();
const roster = page => page.locator(".roster-team li[data-role] select").evaluateAll(items => items.map(item => item.value));
const localState = page => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)])));
const sessionDigest = page => page.evaluate(() => new Promise(resolve => {
  const opening = indexedDB.open("pro-meta-draft", 1);
  opening.onerror = () => resolve(null);
  opening.onsuccess = () => {
    const db = opening.result;
    const read = db.transaction("sessions").objectStore("sessions").get("current");
    read.onerror = () => { db.close(); resolve(null); };
    read.onsuccess = async () => {
      const value = read.result; db.close();
      if (!value) { resolve(null); return; }
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)));
      resolve([...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join(""));
    };
  };
}));

test("load A changes only input numbers while B keeps playing; explicit next run exactly recovers A", async ({ page }, testInfo) => {
  await start(page); const a = await stats(page);
  await seed(page).fill("99999"); await inputs(page).first().fill("0.75");
  await run(page).click(); await end(page); const b = await stats(page);
  await expect(c(page).getByRole("alert")).toContainText("재현 번호가 다릅니다");
  const rosterBefore = await roster(page), localBefore = await localState(page), address = page.url();
  await expect.poll(() => sessionDigest(page)).not.toBeNull(); const saved = await sessionDigest(page);
  await slider(page).focus(); await slider(page).press("Home");
  await p(page).getByRole("button", { name: "재생", exact: true }).click();
  await expect.poll(async () => Number(await slider(page).inputValue())).toBeGreaterThan(0);
  const beforeMinute = Number(await slider(page).inputValue());
  await expect(load(page)).toBeEnabled(); await load(page).click();
  await expect(seed(page)).toHaveValue("4242"); await expect(inputs(page).first()).toHaveValue("0.0000001");
  expect(await inputs(page).evaluateAll(items => items.map(item => Number(item.value)))).toEqual([0.0000001, 0, 0, 0, 0, 0]);
  await expect(p(page).getByRole("button", { name: "일시정지", exact: true })).toBeVisible();
  await expect.poll(async () => Number(await slider(page).inputValue())).toBeGreaterThan(beforeMinute);
  await p(page).getByRole("button", { name: "일시정지", exact: true }).click();
  await expect(p(page).locator(".experiment-replay-identity")).toContainText("실행 #2");
  await expect(c(page).locator(".experiment-comparison-baseline")).toContainText("실행 #1");
  expect(await roster(page)).toEqual(rosterBefore); expect(await localState(page)).toEqual(localBefore);
  expect(await sessionDigest(page)).toBe(saved); expect(page.url()).toBe(address);
  await end(page); expect(await stats(page)).toEqual(b);
  await expect(c(page).getByRole("alert")).toContainText("재현 번호가 다릅니다");
  await expect(c(page).getByRole("status").first()).toContainText("입력란에 불러왔습니다");
  expect((await load(page).boundingBox()).height).toBeGreaterThanOrEqual(44);
  await c(page).screenshot({ path: testInfo.outputPath("baseline-inputs-loaded.png") });
  await run(page).click(); await end(page); expect(await stats(page)).toEqual(a);
  await expect(c(page).locator(".experiment-comparison-kind")).toContainText("가정 변경 없음");
  await expect(p(page).locator(".experiment-replay-identity")).toContainText("실행 #3");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("changed but ready role assignment refuses loading A; restoring context enables numbers-only loading", async ({ page }) => {
  await start(page);
  const readiness = page.locator("details.simulation-readiness"); await open(readiness);
  const top = readiness.locator('.simulation-readiness-team.blue li[data-role="TOP"] select');
  const mid = readiness.locator('.simulation-readiness-team.blue li[data-role="MID"] select');
  const [originalTop, originalMid] = await Promise.all([top.inputValue(), mid.inputValue()]);
  await seed(page).fill("123"); await inputs(page).first().fill("-0.5");
  await top.selectOption(originalMid); await mid.selectOption(originalTop);
  await expect(readiness.getByRole("status").filter({ hasText: "입력 준비 완료" })).toBeVisible();
  await expect(load(page)).toBeDisabled();
  await expect(c(page).locator(".experiment-comparison-load-reason")).toContainText("고정 입력과 달라");
  await expect(seed(page)).toHaveValue("123"); await expect(inputs(page).first()).toHaveValue("-0.5");
  await expect(c(page).locator(".experiment-comparison-baseline")).toContainText("실행 #1");
  await top.selectOption(originalTop); await mid.selectOption(originalMid);
  await expect(load(page)).toBeEnabled(); await load(page).click();
  await expect(seed(page)).toHaveValue("4242"); await expect(inputs(page).first()).toHaveValue("0.0000001");
  await expect(p(page).locator(".experiment-replay-identity")).toContainText("실행 #1");
});
