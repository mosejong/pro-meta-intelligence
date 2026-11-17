import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

/**
 * Publication loading under slow/failed/out-of-order responses. Delays are injected with route();
 * they exercise ordering and timeouts in the client and are not measurements of the real server.
 */
const root = "/pro-meta-intelligence/";
const CORE = /\/feed\/current\.json(\?.*)?$/;
const COMPANIONS = /\/feed\/(collection-status|current-creator|history-status|decision-outcomes|ai-validation|schedule|schedule-changes)\.json(\?.*)?$/;
const feed = JSON.parse(readFileSync(new URL("../../public/feed/current.json", import.meta.url), "utf8"));
const withPatch = (patch_id) => JSON.stringify({ ...feed, patch_id });
const json = (body) => ({ status: 200, contentType: "application/json", body });

const progress = (page) => page.locator(".draft-turn-progress");
const picker = (page) => page.locator(".draft-picker-grid button:not(:disabled)");
const confirm = (page) => page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ });
const feedBadge = (page) => page.locator(".snapshot-state");
const patchLabel = (page) => page.locator(".kicker-row .eyebrow");

function deferred() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}

function trackErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("slow companion files do not block the draft once the core feed is verified", async ({ page }) => {
  const errors = trackErrors(page);
  const gate = deferred();
  let companionRequests = 0;
  await page.route(COMPANIONS, async (route) => {
    companionRequests += 1;
    await gate.promise;
    await route.continue().catch(() => undefined);
  });
  await page.goto(root);
  await expect(page.getByRole("heading", { name: "모의 밴픽", exact: true })).toBeVisible();
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
  await expect(page.getByText(/FEED CONNECTING|DEMO FALLBACK/)).toHaveCount(0);
  await picker(page).first().click();
  await expect(confirm(page)).toBeEnabled();
  await confirm(page).click();
  await expect(progress(page)).toHaveAttribute("value", "1");
  // Companions were requested in parallel and are all still pending while the draft is usable.
  expect(companionRequests).toBeGreaterThanOrEqual(7);
  gate.release();
  expect(errors).toEqual([]);
});

test("a first core failure shows the explicit demo fallback", async ({ page }) => {
  const errors = trackErrors(page);
  await page.route(CORE, (route) => route.fulfill({ status: 503, body: "unavailable" }));
  await page.goto(root);
  // The narrow layout hides the label visually; it must still be the stated feed state.
  await expect(page.getByText("DEMO FALLBACK", { exact: true })).not.toHaveCount(0);
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
  expect(errors).toEqual([]);
});

test("a failed refresh keeps the connected feed, filters and search", async ({ page }) => {
  const errors = trackErrors(page);
  let mode = "ok";
  await page.route(CORE, (route) => mode === "ok"
    ? route.fulfill(json(withPatch("KEEP.1")))
    : route.fulfill({ status: 500, body: "boom" }));
  await page.goto(`${root}radar/`);
  await expect(patchLabel(page)).toContainText("PATCH KEEP.1");
  await expect(feedBadge(page)).not.toHaveText(/CONNECTING|DEMO FALLBACK/);
  const search = page.getByRole("textbox", { name: "챔피언 이름 검색" });
  await search.fill("a");
  const eligible = page.getByRole("checkbox", { name: /기준 통과만/ });
  await page.locator("label.toggle", { hasText: "기준 통과만" }).click();
  await expect(eligible).toBeChecked();

  await page.getByRole("button", { name: "발행 피드 새로고침" }).click();
  await expect(feedBadge(page)).not.toHaveText(/REFRESH FAILED/);
  await expect(search).toHaveValue("a");
  await expect(eligible).toBeChecked();

  mode = "fail";
  await page.getByRole("button", { name: "발행 피드 새로고침" }).click();
  await expect(feedBadge(page)).toHaveText(/REFRESH FAILED · PREVIOUS FEED/);
  await expect(feedBadge(page)).not.toHaveText(/LIVE/);
  await expect(patchLabel(page)).toContainText("PATCH KEEP.1");
  await expect(search).toHaveValue("a");
  await expect(eligible).toBeChecked();
  expect(errors).toEqual([]);
});

test("a failed scheduled refresh keeps the draft in progress", async ({ page }) => {
  const errors = trackErrors(page);
  await page.clock.install();
  let fail = false;
  let failedRefreshes = 0;
  await page.route(CORE, (route) => {
    if (!fail) return route.continue();
    failedRefreshes += 1;
    return route.fulfill({ status: 500, body: "boom" });
  });
  await page.goto(root);
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
  await picker(page).first().click();
  await confirm(page).click();
  await expect(progress(page)).toHaveAttribute("value", "1");
  await picker(page).first().click();
  const staged = await page.locator(".draft-lock-in > div > span").textContent();
  fail = true;
  await page.clock.fastForward("05:01");
  // The studio shows a locked-data label once a draft has started, so assert the refresh happened and failed.
  await expect.poll(() => failedRefreshes).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  await expect(page.getByText("DEMO FALLBACK")).toHaveCount(0);
  await expect(progress(page)).toHaveAttribute("value", "1");
  await expect(page.locator(".draft-lock-in > div > span")).toHaveText(staged);
  await expect(confirm(page)).toBeEnabled();
  expect(errors).toEqual([]);
});

test("a late response from an older refresh never replaces the newer one", async ({ page }) => {
  const errors = trackErrors(page);
  const slow = deferred();
  let calls = 0;
  await page.route(CORE, async (route) => {
    calls += 1;
    if (calls === 1) return route.fulfill(json(withPatch("FIRST.0")));
    if (calls === 2) { await slow.promise; return route.fulfill(json(withPatch("OLD.1"))).catch(() => undefined); }
    return route.fulfill(json(withPatch("NEW.2")));
  });
  await page.goto(`${root}radar/`);
  await expect(patchLabel(page)).toContainText("PATCH FIRST.0");
  const refresh = page.getByRole("button", { name: "발행 피드 새로고침" });
  await refresh.click();
  await expect.poll(() => calls).toBe(2);
  await refresh.click();
  await expect(patchLabel(page)).toContainText("PATCH NEW.2");
  slow.release();
  await page.waitForTimeout(1_000);
  await expect(patchLabel(page)).toContainText("PATCH NEW.2");
  expect(errors).toEqual([]);
});

test("a local file loaded while the feed is still loading is not overwritten", async ({ page }) => {
  const errors = trackErrors(page);
  const slow = deferred();
  let coreRequested = false;
  await page.route(CORE, async (route) => {
    coreRequested = true;
    await slow.promise;
    await route.fulfill(json(withPatch("AUTO.1"))).catch(() => undefined);
  });
  await page.goto(`${root}radar/`);
  await expect.poll(() => coreRequested).toBe(true);
  await page.getByLabel("Meta Radar JSON 불러오기").setInputFiles({
    name: "local.json", mimeType: "application/json", buffer: Buffer.from(withPatch("LOCAL.9")),
  });
  await expect(feedBadge(page)).toHaveText("LOCAL FILE");
  await expect(patchLabel(page)).toContainText("PATCH LOCAL.9");
  slow.release();
  await page.waitForTimeout(1_000);
  await expect(feedBadge(page)).toHaveText("LOCAL FILE");
  await expect(patchLabel(page)).toContainText("PATCH LOCAL.9");
  expect(errors).toEqual([]);
});
