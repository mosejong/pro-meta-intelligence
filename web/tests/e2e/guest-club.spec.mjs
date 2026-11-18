import { test, expect } from "@playwright/test";
import { showPanel } from "./studio-panels.mjs";

const root = "/pro-meta-intelligence/";
const storageKey = "pro-meta-guest-clubs-v1";
const roles = ["TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT"];
const club = (page) => page.locator(".guest-club");
const entries = (page) => page.locator(".guest-club-list article");
const slot = (page, side, role) => page.locator(`.roster-team.${side} li[data-role="${role}"] select`);
const progress = (page) => page.locator(".draft-turn-progress");

async function openRoster(page) {
  await showPanel(page, "ROSTER");
  const workshop = page.locator("details.roster-workshop");
  if ((await workshop.getAttribute("open")) === null) await workshop.locator("> summary").click();
  await expect(club(page)).toBeVisible();
  await expect(slot(page, "blue", "TOP")).toBeEnabled();
}

async function openStudioWithDraftTurn(page) {
  await page.goto(root);
  await expect(page.getByRole("heading", { name: "모의 밴픽", exact: true })).toBeVisible();
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
  await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
  await page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ }).click();
  await expect(progress(page)).toHaveAttribute("value", "1");
  await openRoster(page);
}

async function fillClub(page, name) {
  await club(page).getByLabel("구단 이름", { exact: true }).fill(name);
  const coaches = club(page).locator("details");
  if ((await coaches.getAttribute("open")) === null) await coaches.locator("summary").click();
  await club(page).getByLabel("감독 이름", { exact: true }).fill("게스트 감독");
  await club(page).getByLabel("코치 이름", { exact: true }).fill("게스트 코치");
  await club(page).getByLabel("저장할 진영", { exact: true }).selectOption("BLUE");
}

async function values(page, side) {
  return Promise.all(roles.map((role) => slot(page, side, role).inputValue()));
}

test("guest clubs save a side including empty slots, confirm loads and persist until confirmed deletion", async ({ page }) => {
  await openStudioWithDraftTurn(page);
  const originalTop = await slot(page, "blue", "TOP").inputValue();
  expect(originalTop).not.toBe("");
  await slot(page, "blue", "TOP").selectOption("");
  const savedBlue = await values(page, "blue");
  const originalRed = await values(page, "red");
  await fillClub(page, "게스트 블루 구단");
  await club(page).getByRole("button", { name: "새 구단으로 저장", exact: true }).click();
  await expect(entries(page)).toHaveCount(1);
  const entry = entries(page).filter({ hasText: "게스트 블루 구단" });
  await expect(entry).toContainText("게스트 감독");
  await expect(entry).toContainText("게스트 코치");
  await club(page).screenshot({ path: test.info().outputPath("guest-club-saved.png") });
  await expect(progress(page)).toHaveAttribute("value", "1");

  await slot(page, "blue", "TOP").selectOption(originalTop);
  const mutatedBlue = await values(page, "blue");
  await entry.getByRole("button", { name: "불러오기", exact: true }).click();
  const load = page.getByRole("group", { name: "구단 불러오기 확인", exact: true });
  await expect(load).toBeVisible();
  await load.getByRole("button", { name: "취소", exact: true }).click();
  await expect(load).not.toBeVisible();
  expect(await values(page, "blue")).toEqual(mutatedBlue);
  expect(await values(page, "red")).toEqual(originalRed);
  await expect(progress(page)).toHaveAttribute("value", "1");

  await entry.getByRole("button", { name: "불러오기", exact: true }).click();
  await load.getByRole("button", { name: "불러오기 확정", exact: true }).click();
  await expect(load).not.toBeVisible();
  await expect(slot(page, "blue", "TOP")).toHaveValue("");
  expect(await values(page, "blue")).toEqual(savedBlue);
  expect(await values(page, "red")).toEqual(originalRed);
  await expect(progress(page)).toHaveAttribute("value", "1");

  await page.reload();
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
  await openRoster(page);
  await expect(entries(page)).toHaveCount(1);
  await expect(entry).toContainText("게스트 감독");
  await expect(entry).toContainText("게스트 코치");
  await expect(progress(page)).toHaveAttribute("value", "1");
  const stored = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  expect(stored).not.toBeNull();

  await entry.getByRole("button", { name: "삭제", exact: true }).click();
  const deletion = page.getByRole("group", { name: "구단 삭제 확인", exact: true });
  await expect(deletion).toBeVisible();
  await deletion.getByRole("button", { name: "취소", exact: true }).click();
  await expect(deletion).not.toBeVisible();
  await expect(entries(page)).toHaveCount(1);
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(stored);
  await entry.getByRole("button", { name: "삭제", exact: true }).click();
  await deletion.getByRole("button", { name: "삭제 확정", exact: true }).click();
  await expect(entries(page)).toHaveCount(0);
  expect(await values(page, "blue")).toEqual(savedBlue);
  expect(await values(page, "red")).toEqual(originalRed);
  await expect(progress(page)).toHaveAttribute("value", "1");
  await page.reload();
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
  await openRoster(page);
  await expect(entries(page)).toHaveCount(0);
  await expect(progress(page)).toHaveAttribute("value", "1");
});

test("a denied guest club write reports an error without a phantom saved club", async ({ page }) => {
  await page.addInitScript((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (this === window.localStorage && name === key) {
        throw new DOMException("QA injected guest club storage denial", "QuotaExceededError");
      }
      return original.call(this, name, value);
    };
  }, storageKey);
  await openStudioWithDraftTurn(page);
  const before = { blue: await values(page, "blue"), red: await values(page, "red") };
  await fillClub(page, "저장 실패 구단");
  await club(page).getByRole("button", { name: "새 구단으로 저장", exact: true }).click();
  await expect(club(page).getByRole("alert")).toBeVisible();
  await expect(entries(page)).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBeNull();
  expect({ blue: await values(page, "blue"), red: await values(page, "red") }).toEqual(before);
  await expect(progress(page)).toHaveAttribute("value", "1");
  await page.reload();
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
  await openRoster(page);
  await expect(entries(page)).toHaveCount(0);
});

test("saving never overwrites a corrupted guest club library", async ({ page }) => {
  await openStudioWithDraftTurn(page);
  const corrupted = '{"clubs": [broken guest club library';
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: storageKey, value: corrupted });
  await page.reload();
  await expect(page.locator(".draft-stage")).not.toHaveAttribute("inert", "");
  await openRoster(page);
  const before = { blue: await values(page, "blue"), red: await values(page, "red") };
  await fillClub(page, "손상 보존 구단");
  await expect(club(page).getByRole("button", { name: "새 구단으로 저장", exact: true })).toBeDisabled();
  await expect(club(page).getByRole("alert")).toBeVisible();
  await expect(entries(page)).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(corrupted);
  expect({ blue: await values(page, "blue"), red: await values(page, "red") }).toEqual(before);
  await expect(progress(page)).toHaveAttribute("value", "1");
});

test("two tabs saving together preserve both clubs", async ({ page, context }) => {
  await openStudioWithDraftTurn(page);
  const other = await context.newPage();
  try {
    await other.goto(root); await expect(other.locator(".draft-stage")).not.toHaveAttribute("inert", ""); await openRoster(other);
    await fillClub(page, "첫 번째 탭 구단"); await fillClub(other, "두 번째 탭 구단");
    await Promise.all([page, other].map(p => club(p).getByRole("button", { name: "새 구단으로 저장", exact: true }).click()));
    for (const p of [page, other]) {
      await expect(entries(p)).toHaveCount(2);
      await expect(club(p)).toContainText("첫 번째 탭 구단"); await expect(club(p)).toContainText("두 번째 탭 구단");
    }
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
    expect(saved.clubs.map(c => c.name).sort()).toEqual(["두 번째 탭 구단", "첫 번째 탭 구단"].sort());
  } finally { await other.close(); }
});
