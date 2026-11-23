import { test, expect } from "@playwright/test";
import { enterDraftForReview } from "./enter-draft-review.mjs";
import { showPanel } from "./studio-panels.mjs";

const root = "/pro-meta-intelligence/";
const experiment = page => page.locator("section.experiment-replay");
const share = page => page.locator("details.experiment-input-link");
const fields = page => experiment(page).locator('.experiment-replay-team input[type="number"]');
const seed = page => experiment(page).getByLabel("재현 번호 (시드)", { exact: true });
const runButton = page => experiment(page).locator('button[type="submit"]');
const slider = page => experiment(page).locator('.experiment-replay-seek input[type="range"]');
const copy = page => share(page).getByRole("button", { name: "가정값 링크 복사", exact: true });
const apply = page => share(page).getByRole("button", { name: "가정값 적용", exact: true });
async function openShare(page) {
  await showPanel(page, "SIMULATION");
  if (await share(page).getAttribute("open") === null) await share(page).locator(":scope > summary").click();
}
async function prepare(page) {
  const example = page.locator("details.simulation-example");
  if (await example.getAttribute("open") === null) await example.locator(":scope > summary").click();
  await example.getByRole("button", { name: "이 예시로 입력 준비", exact: true }).click();
  await expect(runButton(page)).toBeEnabled();
}
async function end(page) { await slider(page).focus(); await slider(page).press("End"); }
async function sourceRun(page) {
  await page.goto(root);
  await enterDraftForReview(page);
  await enterDraftForReview(page);
  await openShare(page); await expect(copy(page)).toBeDisabled();
  await prepare(page); await seed(page).fill("4242");
  await fields(page).nth(0).fill("0.0000001"); await fields(page).nth(5).fill("-0.3");
  await runButton(page).click(); await expect(copy(page)).toBeDisabled(); await end(page);
  await expect(copy(page)).toBeEnabled();
}
const finalState = page => experiment(page).locator('.experiment-replay-states [data-stat]').allTextContents();

test("assumption-only link: fresh recipient must prepare, explicitly apply, then explicitly run", async ({ page, browser }, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } }));
  await sourceRun(page);
  const values = await fields(page).evaluateAll(inputs => inputs.map(input => Number(input.value)));
  const outcome = await finalState(page);
  expect(outcome.length).toBeGreaterThan(0);
  await copy(page).click();
  const urlBox = share(page).getByLabel("가정값 링크 (직접 복사)", { exact: true });
  await expect(urlBox).toBeVisible(); const link = await urlBox.inputValue();
  expect(new URL(page.url()).hash).toBe("");
  const payload = JSON.parse(Buffer.from(new URL(link).hash.slice("#experiment=".length), "base64url").toString("utf8"));
  expect(Object.keys(payload).sort()).toEqual(["schema", "version", "ruleset", "patch", "seed", "teams"].sort());
  for (const team of payload.teams) expect(Object.keys(team).sort()).toEqual(["id", "lane", "tempo", "teamfight"].sort());
  await seed(page).fill("98765"); await fields(page).nth(0).fill("-0.9");
  await copy(page).click(); expect(await urlBox.inputValue()).toBe(link);
  expect(await finalState(page)).toEqual(outcome);

  const receiver = await browser.newPage({ viewport: testInfo.project.use.viewport, isMobile: Boolean(testInfo.project.use.isMobile), hasTouch: Boolean(testInfo.project.use.hasTouch) });
  try {
    await receiver.goto(link); await enterDraftForReview(receiver); await openShare(receiver);
    await expect(share(receiver)).toContainText("링크에서 받은 가정값");
    await expect(share(receiver)).toContainText("시드 4242");
    await expect(apply(receiver)).toBeDisabled();
    await expect(experiment(receiver).locator(".experiment-replay-result")).toHaveCount(0);
    await prepare(receiver);
    await expect(seed(receiver)).toHaveValue("1");
    await expect(apply(receiver)).toBeEnabled(); await apply(receiver).click();
    await expect(seed(receiver)).toHaveValue("4242");
    expect(await fields(receiver).evaluateAll(inputs => inputs.map(input => Number(input.value)))).toEqual(values);
    await expect(fields(receiver).nth(0)).toHaveValue("0.0000001");
    await expect(experiment(receiver).locator(".experiment-replay-result")).toHaveCount(0);
    const roster = await receiver.locator(".roster-team li[data-role] select").evaluateAll(inputs => inputs.map(input => input.value));
    await runButton(receiver).click(); await end(receiver); expect(await finalState(receiver)).toEqual(outcome);
    const compare = experiment(receiver).locator("details.experiment-comparison");
    await compare.locator(":scope > summary").click();
    await compare.getByRole("button", { name: "이 실행을 비교 기준 A로 보관", exact: true }).click();
    await share(receiver).screenshot({ path: testInfo.outputPath("assumption-input-link-normal.png") });
    const edited = structuredClone(payload); edited.seed = 123; edited.teams[0].lane = Number.MIN_VALUE;
    const hash = "experiment=" + Buffer.from(JSON.stringify(edited)).toString("base64url");
    await receiver.evaluate(value => { location.hash = value; }, hash);
    await expect(share(receiver)).toContainText("시드 123"); await apply(receiver).click();
    await expect(seed(receiver)).toHaveValue("123");
    const tiny = await fields(receiver).nth(0).inputValue(); expect(tiny).not.toMatch(/e/i); expect(Number(tiny)).toBe(Number.MIN_VALUE);
    await expect(runButton(receiver)).toBeEnabled();
    await expect(experiment(receiver).locator(".experiment-replay-identity")).toContainText("실행 #1");
    await expect(compare.locator(".experiment-comparison-baseline")).toContainText("실행 #1");
    expect(await finalState(receiver)).toEqual(outcome);
    expect(await receiver.locator(".roster-team li[data-role] select").evaluateAll(inputs => inputs.map(input => input.value))).toEqual(roster);
    expect(new URL(receiver.url()).hash).toBe("#" + hash);
    expect(await receiver.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    expect((await apply(receiver).boundingBox()).height).toBeGreaterThanOrEqual(44);
    await share(receiver).screenshot({ path: testInfo.outputPath("assumption-input-link-received.png") });
  } finally { await receiver.close(); }
});

test("assumption-only link: late clipboard answers do not survive rewind or URL change", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => new Promise(resolve => { window.__releaseInputLinkCopy = resolve; }) } }));
  await sourceRun(page); await copy(page).click(); await expect(copy(page)).toBeDisabled();
  await slider(page).focus(); await slider(page).press("Home"); await end(page);
  await expect(copy(page)).toBeEnabled(); await page.evaluate(() => window.__releaseInputLinkCopy());
  await expect(share(page)).not.toContainText("복사했어요"); await expect(share(page).locator("textarea")).toHaveCount(0);
  await copy(page).click();
  await page.evaluate(() => { location.hash = "other-fragment"; });
  await expect(copy(page)).toBeEnabled(); await page.evaluate(() => window.__releaseInputLinkCopy());
  await expect(share(page)).not.toContainText("복사했어요");
  expect(new URL(page.url()).hash).toBe("#other-fragment");
  await copy(page).click(); await page.evaluate(() => window.__releaseInputLinkCopy());
  await expect(share(page)).toContainText("복사했어요");
  expect(new URL(page.url()).hash).toBe("#other-fragment");
});
