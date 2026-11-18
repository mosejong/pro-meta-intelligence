import { test, expect } from "@playwright/test";

// Parent runner supplies a real room endpoint through VITE_DRAFT_ROOM_ENDPOINT
// and serves the existing application. These tests never fake room broadcasts.
const root = "/pro-meta-intelligence/";
const room = page => page.locator(".draft-room");
const progress = page => page.locator(".draft-turn-progress");
const confirm = page => page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ });
const available = page => page.locator(".draft-picker-grid button:not(:disabled)");
async function ready(page) { await expect(page.getByRole("button", { name: "밴픽 링크 복사", exact: true })).toBeEnabled(); }
async function prepare(context) {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async value => { window.__roomLink = value; } } });
  });
}
async function copy(page, name) {
  await room(page).getByRole("button", { name, exact: true }).click();
  return page.evaluate(() => window.__roomLink);
}
async function pick(page) { await available(page).first().click(); await confirm(page).click(); }
async function create(page) {
  await page.goto(root); await ready(page);
  await room(page).locator("summary").click();
  await room(page).getByRole("button", { name: "현재 밴픽으로 방 만들기", exact: true }).click();
  await room(page).getByRole("button", { name: "동의하고 방 만들기", exact: true }).click();
  await expect(room(page)).toContainText("블루 · 방장");
  await expect(room(page)).toContainText("레드 참가를 기다리고 있습니다.");
}
test("real blue, red and spectator sync turns; reconnect and explicit leave preserve solo copy", async ({ browser }, testInfo) => {
  test.setTimeout(120000);
  const { viewport, isMobile, hasTouch, baseURL } = testInfo.project.use;
  const options = { ...(baseURL ? { baseURL } : {}), ...(viewport !== undefined ? { viewport } : {}), ...(isMobile !== undefined ? { isMobile } : {}), ...(hasTouch !== undefined ? { hasTouch } : {}) };
  const blueContext = await browser.newContext(options), redContext = await browser.newContext(options), spectatorContext = await browser.newContext(options);
  try {
    await Promise.all([prepare(blueContext), prepare(redContext), prepare(spectatorContext)]);
    const blue = await blueContext.newPage(), red = await redContext.newPage(), spectator = await spectatorContext.newPage();
    await create(blue);
    await expect(available(blue)).toHaveCount(0);
    const hostRoomId = JSON.parse(Buffer.from(new URL(blue.url()).hash.slice(6), "base64url")).id;
    const hostBeforeReload = await blue.evaluate(id => JSON.parse(sessionStorage.getItem("draft-room:" + id)), hostRoomId);
    await blue.reload(); await ready(blue);
    await room(blue).getByRole("button", { name: "이 방에 다시 참여", exact: true }).click();
    await expect(room(blue)).toContainText("레드 참가를 기다리고 있습니다.");
    await expect(room(blue).getByRole("button", { name: "레드 초대 링크 복사", exact: true })).toBeEnabled();
    const hostAfterReload = await blue.evaluate(id => JSON.parse(sessionStorage.getItem("draft-room:" + id)), hostRoomId);
    expect(hostAfterReload.token).toBe(hostBeforeReload.token);
    const invite = await copy(blue, "레드 초대 링크 복사"), view = await copy(blue, "관전 링크 복사");
    const inviteData = JSON.parse(Buffer.from(new URL(invite).hash.slice(6), "base64url"));
    const viewData = JSON.parse(Buffer.from(new URL(view).hash.slice(6), "base64url"));
    expect(Object.keys(inviteData).sort()).toEqual(["id", "invite", "v"]);
    expect(Object.keys(viewData).sort()).toEqual(["id", "v", "view"]);
    const owner = await blue.evaluate(id => JSON.parse(sessionStorage.getItem("draft-room:" + id)), inviteData.id);
    expect(inviteData.invite).not.toBe(owner.token); expect(viewData.view).not.toBe(owner.token);
    expect(new URL(invite).search).toBe(""); expect(invite).not.toContain(owner.token);
    await red.goto(invite); await ready(red);
    await expect(progress(red)).toHaveAttribute("value", "0");
    await room(red).getByRole("button", { name: "레드로 참가", exact: true }).click();
    await expect(room(red)).toContainText("밴픽 진행 중");
    await spectator.goto(view); await ready(spectator);
    await room(spectator).getByRole("button", { name: "관전하기", exact: true }).click();
    await expect(room(spectator)).toContainText("관전 중");
    await expect(available(red)).toHaveCount(0); await expect(available(spectator)).toHaveCount(0);
    await expect(confirm(red)).toBeDisabled(); await expect(confirm(spectator)).toBeDisabled();
    for (const page of [blue, red, spectator]) {
      await page.locator(".draft-session-details summary").click();
      await expect(page.locator('.draft-session-controls input[type="file"]')).toBeDisabled();
      await expect(page.locator(".draft-first-selection select")).toBeDisabled();
      await expect(page.getByRole("button", { name: "밴픽 링크 복사", exact: true })).toBeDisabled();
    }
    await expect(available(blue).first()).toBeEnabled(); await pick(blue);
    for (const page of [blue, red, spectator]) await expect(progress(page)).toHaveAttribute("value", "1");
    await expect(available(blue)).toHaveCount(0); await expect(available(red).first()).toBeEnabled();
    await pick(red);
    for (const page of [blue, red, spectator]) await expect(progress(page)).toHaveAttribute("value", "2");
    await redContext.setOffline(true);
    await expect(room(red)).toContainText("연결을 다시 확인", { timeout: 15000 });
    await expect(available(red)).toHaveCount(0);
    await pick(blue); await expect(progress(blue)).toHaveAttribute("value", "3");
    await redContext.setOffline(false);
    await expect(progress(red)).toHaveAttribute("value", "3", { timeout: 20000 });
    await expect(room(red)).toContainText("밴픽 진행 중");
    // Reload must offer explicit resume and use the existing RED capability.
    await red.reload(); await ready(red);
    await expect(room(red).getByRole("button", { name: "이 방에 다시 참여", exact: true })).toBeEnabled();
    await expect(room(red).getByRole("button", { name: "레드로 참가", exact: true })).toHaveCount(0);
    await room(red).getByRole("button", { name: "이 방에 다시 참여", exact: true }).click();
    await expect(room(red)).toContainText("밴픽 진행 중");
    await expect(progress(red)).toHaveAttribute("value", "3");
    for (let count = 4; count <= 20; count++) {
      await expect.poll(async () => await available(blue).count() + await available(red).count()).toBeGreaterThan(0);
      const acting = await available(blue).count() ? blue : red;
      const waiting = acting === blue ? red : blue;
      await expect(available(waiting)).toHaveCount(0);
      await expect(available(spectator)).toHaveCount(0);
      await expect(confirm(acting)).toBeDisabled();
      await pick(acting);
      for (const page of [blue, red, spectator]) await expect(progress(page)).toHaveAttribute("value", String(count));
    }
    const previousPicks = await blue.locator(".draft-pick-stack article.filled strong").allTextContents();
    expect(previousPicks).toHaveLength(10);
    await blue.screenshot({ path: testInfo.outputPath("completed-draft.png"), fullPage: true });
    await spectator.screenshot({ path: testInfo.outputPath("spectator-draft.png"), fullPage: true });
    for (const page of [blue, red, spectator]) { await expect(available(page)).toHaveCount(0); await expect(confirm(page)).toBeDisabled(); }
    await expect(room(blue).getByRole("button", { name: "방 다음 세트", exact: true })).toBeEnabled();
    await room(blue).getByRole("button", { name: "방 다음 세트", exact: true }).click();
    for (const page of [blue, red, spectator]) {
      await expect(progress(page)).toHaveAttribute("value", "0");
      await expect(page.locator(".draft-series > header")).toContainText("이전 세트 양 팀 픽 10개 자동 잠금");
      await expect(page.locator(".draft-series-locks > span")).toHaveCount(10);
      // Turn off the available-only filter to inspect all ten hard Fearless locks.
      await page.locator('.draft-picker-filter input[type="checkbox"]').uncheck();
      for (const name of previousPicks) {
        const champion = page.locator(".draft-picker-grid button").filter({ has: page.locator("span", { hasText: new RegExp(`^${name}$`) }) });
        await expect(champion).toBeDisabled();
        await expect(champion.locator("b")).toHaveText("피어리스");
      }
    }
    await room(red).getByRole("button", { name: "혼자 연습으로 돌아가기", exact: true }).click();
    await expect(progress(red)).toHaveAttribute("value", "0");
    await expect(red.locator(".draft-series > header")).toContainText("이전 세트 양 팀 픽 10개 자동 잠금");
    await expect(red.locator('.draft-session-controls input[type="file"]')).toBeEnabled();
    const retained = await red.evaluate(id => JSON.parse(sessionStorage.getItem("draft-room:" + id)), inviteData.id);
    expect(retained.role).toBe("RED");
  } finally { await Promise.all([blueContext.close(), redContext.close(), spectatorContext.close()]); }
});

test("creation consent can be cancelled without replacing personal draft", async ({ page }) => {
  await page.goto(root); await ready(page); await pick(page);
  await expect(progress(page)).toHaveAttribute("value", "1");
  await room(page).locator("summary").click();
  await room(page).getByRole("button", { name: "현재 밴픽으로 방 만들기", exact: true }).click();
  await room(page).getByRole("button", { name: "취소", exact: true }).click();
  await expect(progress(page)).toHaveAttribute("value", "1");
  await expect(confirm(page)).toBeDisabled(); // No staged choice survives by accident.
  await expect(page.getByRole("button", { name: "밴픽 링크 복사", exact: true })).toBeEnabled();
});

test("late invite clipboard completion is ignored after leaving", async ({ page }) => {
  await create(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => new Promise(resolve => { window.__finishRoomCopy = resolve; }) } });
  });
  await room(page).getByRole("button", { name: "레드 초대 링크 복사", exact: true }).click();
  await room(page).getByRole("button", { name: "혼자 연습으로 돌아가기", exact: true }).click();
  await page.evaluate(() => window.__finishRoomCopy());
  await expect(room(page).getByText("초대 링크를 복사했습니다.", { exact: true })).toHaveCount(0);
});
