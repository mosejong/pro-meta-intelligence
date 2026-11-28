import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { enterDraftForReview } from "./enter-draft-review.mjs";
import { showPanel } from "./studio-panels.mjs";

const captures = new URL("../../../docs/captures/2026-11-28-roster-context/", import.meta.url);

// Vertical flow: mixed current/season lineup → explicit "관측 문맥 준비" → save practice (bundle v3) →
// different lineup → load → re-verified preparation resumed; then the not-restored path when the
// season catalog provenance (sources.retrieved_at only) changed.
test("prepared roster observation context is saved with a practice and resumed only when sources still match", async ({ page }, testInfo) => {
  await page.goto("/pro-meta-intelligence/");
  await enterDraftForReview(page);
  const pickTurn = async () => {
    await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
    await page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ }).click();
  };
  await pickTurn();
  await showPanel(page, "ROSTER");
  const observation = page.locator("section.roster-observation");
  test.skip(await observation.count() === 0, "roster-workshop/draft-lab integration diff is not applied in this build");

  // Mixed lineup: load the season catalog and put 2022 Nuguri in BLUE TOP (the current player leaves that slot).
  const season = page.locator("details.season-lineup");
  if (await season.getAttribute("open") === null) await season.locator(":scope > summary").click();
  const response = page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/history/season-player-cards.json"));
  await season.getByRole("button", { name: "시즌 선수 자료 불러오기", exact: true }).click();
  const catalog = await (await response).json();
  const nuguri = catalog.cards.find(c => c.season === 2022 && c.player_name === "Nuguri" && c.role === "TOP");
  const nuguriSlot = season.getByLabel("BLUE 탑 시즌 선수", { exact: true });
  await nuguriSlot.selectOption(nuguri.id);

  // Opt-in is explicit (default off).
  const flag = observation.getByRole("checkbox", { name: "사용(기본 꺼짐)" });
  await expect(flag).not.toBeChecked();
  await flag.check();
  const prepare = observation.getByRole("button", { name: "관측 문맥 준비", exact: true });
  const status = observation.locator(".roster-observation-status, .roster-observation-card");

  // An empty slot is refused and the roster stays as it was.
  const redSelects = page.locator(".roster-team.red select");
  const redMid = redSelects.nth(2);
  const midValue = await redMid.inputValue();
  await redMid.selectOption("");
  await prepare.click();
  await expect(observation.getByRole("alert")).toContainText("준비하지 않았습니다");
  await expect(redMid).toHaveValue("");
  await redMid.selectOption(midValue);
  await expect(status).toContainText("준비된 관측 문맥 없음");

  await prepare.click();
  const card = observation.locator(".roster-observation-card");
  await expect(card).toContainText("검증된 관측 문맥");
  await expect(card).toContainText("Nuguri");
  await expect(card).toContainText("2022 시즌");
  const key = await card.locator("dd[title]").first().getAttribute("title");
  expect(key).toMatch(/^[a-f0-9]{64}$/);
  const asOf = await card.locator("time").getAttribute("datetime");
  await card.scrollIntoViewIfNeeded();
  await mkdir(captures, { recursive: true });
  await observation.screenshot({ path: new URL(`prepared-${testInfo.project.name}.png`, captures).pathname });

  // A→B→A withdraws the preparation.
  const redJungle = redSelects.nth(1);
  const jungleValue = await redJungle.inputValue();
  const otherValue = await redJungle.locator("optgroup").nth(1).locator("option").first().getAttribute("value");
  await redJungle.selectOption(otherValue);
  await redJungle.selectOption(jungleValue);
  await expect(status).toContainText("준비된 관측 문맥 없음");
  await prepare.click();
  await expect(card).toContainText("검증된 관측 문맥");
  const savedKey = await card.locator("dd[title]").first().getAttribute("title");
  const savedAsOf = await card.locator("time").getAttribute("datetime");
  expect(savedAsOf >= asOf).toBe(true);

  // Simulation tab shows only a summary; nothing becomes experiment input.
  await showPanel(page, "SIMULATION");
  await expect(page.locator(".roster-observation-summary")).toContainText("시즌 선수 1");

  // Save with "선수 구성 포함".
  await showPanel(page, "DRAFT");
  const library = page.locator("details.draft-practice-library");
  await library.locator(":scope > summary").click();
  await expect(library.getByRole("checkbox")).toBeChecked();
  await library.getByLabel("연습 이름", { exact: true }).fill("관측 문맥 재개");
  await library.getByRole("button", { name: "이 연습 저장", exact: true }).click();
  await expect(library.getByRole("status").first()).toContainText("관측 문맥(선수 참조·자료 기준)도 함께 저장");
  await expect(library).toContainText("관측 문맥 포함");

  // Different lineup and board.
  await showPanel(page, "ROSTER");
  await redJungle.selectOption(otherValue);
  await expect(status).toContainText("준비된 관측 문맥 없음");
  await showPanel(page, "DRAFT");
  await pickTurn();

  // Load: season check → report/catalog re-verification → rebuild from the applied owner state.
  await library.getByRole("button", { name: "관측 문맥 재개 열기", exact: true }).click();
  await library.getByRole("alertdialog").getByRole("button", { name: "바꾸기", exact: true }).click();
  await expect(library.getByRole("status").first()).toContainText("출처를 다시 확인했고");
  await expect(page.locator(".draft-turn-progress")).toHaveAttribute("value", "1");
  await showPanel(page, "ROSTER");
  await expect(card).toContainText("저장된 관측 문맥을 다시 확인해 복원했습니다");
  await expect(card.locator("dd[title]").first()).toHaveAttribute("title", savedKey);
  await expect(card.locator("time")).toHaveAttribute("datetime", savedAsOf);
  await expect(redJungle).toHaveValue(jungleValue);
  await expect(nuguriSlot).toHaveValue(nuguri.id);
  await card.scrollIntoViewIfNeeded();
  await observation.screenshot({ path: new URL(`restored-${testInfo.project.name}.png`, captures).pathname });

  // Not-restored path: only sources.retrieved_at changed (same catalog_id/cutoff, season refs still verify).
  await redJungle.selectOption(otherValue);
  await showPanel(page, "DRAFT");
  await pickTurn();
  const moved = structuredClone(catalog);
  moved.sources[0].retrieved_at = moved.sources[0].retrieved_at.replace(/(\d)(\+00:00|Z)$/, (_, d, z) => `${(Number(d) + 1) % 10}${z}`);
  await page.route("**/history/season-player-cards.json", route => route.fulfill({ json: moved }));
  await library.getByRole("button", { name: "관측 문맥 재개 열기", exact: true }).click();
  await library.getByRole("alertdialog").getByRole("button", { name: "바꾸기", exact: true }).click();
  await expect(library.getByRole("status").first()).toContainText("저장된 관측 문맥은 복원하지 않았습니다");
  await expect(library.getByRole("status").first()).toContainText("시즌 선수 구성도 복원");
  await showPanel(page, "ROSTER");
  await expect(nuguriSlot).toHaveValue(nuguri.id);
  await expect(redJungle).toHaveValue(jungleValue);
  await expect(status).toContainText("준비된 관측 문맥 없음");
  await expect(observation.locator(".roster-observation-card")).toHaveCount(0);
  await observation.screenshot({ path: new URL(`not-restored-${testInfo.project.name}.png`, captures).pathname });
});
