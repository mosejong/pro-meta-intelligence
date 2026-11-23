import { test, expect } from "@playwright/test";
import { enterDraftForReview } from "./enter-draft-review.mjs";

const STORAGE_KEY = "pmi.testerFeedback.v1";

test("tester feedback: answer, keep across reload, copy readable text, save .txt, clear", async ({ page }, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true,
    value: { writeText: async (text) => { window.__copied = text; } } }));
  await page.goto("/pro-meta-intelligence/");
  await enterDraftForReview(page);
  // One confirmed ban so the attached context reflects real progress.
  await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
  await page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ }).click();
  await expect(page.locator(".draft-turn-progress")).toHaveAttribute("value", "1");

  await page.getByRole("button", { name: "테스트 의견 남기기", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "테스트 의견 남기기" });
  await expect(dialog).toBeVisible();
  const copy = dialog.getByRole("button", { name: "의견 복사", exact: true });
  await expect(copy).toBeDisabled();

  await dialog.getByRole("group", { name: "어떤 기기로 써봤나요?" }).getByLabel("휴대폰").check();
  await dialog.getByRole("group", { name: /어디에서 멈추거나/ }).getByLabel("저장·불러오기").check();
  await dialog.getByLabel("딱 하나만 고친다면 무엇인가요?").fill("저장 위치 안내\n연락은 010-1234-5678");
  await expect(dialog.getByRole("list", { name: "함께 붙는 화면 상태" })).toContainText("현재 세트 1/20 차례");
  await expect(copy).toBeEnabled();
  if (testInfo.project.name === "mobile-width") {
    const box = await dialog.boundingBox();
    expect(box.width).toBeLessThanOrEqual(390);
  }

  // The draft survives closing and a full reload (answers only).
  await dialog.getByRole("button", { name: "의견 창 닫기" }).click();
  await expect(dialog).toBeHidden();
  const stored = await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY);
  expect(stored).toContain("PHONE");
  expect(stored).not.toContain("16.");
  await page.reload();
  await enterDraftForReview(page);
  await page.getByRole("button", { name: "테스트 의견 남기기", exact: true }).click();
  await expect(dialog.getByLabel("휴대폰")).toBeChecked();
  await expect(dialog.getByLabel("딱 하나만 고친다면 무엇인가요?")).toHaveValue("저장 위치 안내\n연락은 010-1234-5678");

  await copy.click();
  await expect(dialog.getByText("의견을 클립보드에 복사했어요.")).toBeVisible();
  await expect(dialog.getByText("연락처처럼 보이는 내용 1곳을 글에서 지웠어요.")).toBeVisible();
  const text = await page.evaluate(() => window.__copied);
  expect(text).toContain("[Pro Meta Intelligence 테스트 의견]");
  expect(text).toContain("기기: 휴대폰");
  expect(text).toContain("멈추거나 헷갈린 곳: 저장·불러오기");
  expect(text).toContain("[연락처 지움]");
  expect(text).not.toContain("5678");
  expect(text).toContain("[자동 첨부");
  expect(text).toMatch(/화면 폭: (넓은|좁은) 화면/);

  // Context can be left out entirely.
  await dialog.getByLabel("지금 화면 상태도 함께 붙이기").uncheck();
  await copy.click();
  await expect.poll(() => page.evaluate(() => window.__copied)).not.toContain("[자동 첨부");

  const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "의견 파일로 저장" }).click()]);
  expect(download.suggestedFilename()).toBe("pro-meta-test-feedback.txt");
  const saved = await (await download.createReadStream()).toArray();
  expect(Buffer.concat(saved).toString("utf8")).toBe(await page.evaluate(() => window.__copied));

  // Clearing needs a second confirmation and empties storage.
  await dialog.getByRole("button", { name: "작성 내용 지우기" }).click();
  await dialog.getByRole("button", { name: "모두 지우기" }).click();
  await expect(dialog.getByLabel("휴대폰")).not.toBeChecked();
  await expect(copy).toBeDisabled();
  expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBeNull();

  // Escape closes; the board is untouched by any of this.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator(".draft-turn-progress")).toHaveAttribute("value", "1");
  await page.screenshot({ path: testInfo.outputPath("after.png") });
});

test("tester feedback works when browser storage is blocked", async ({ page }) => {
  await page.addInitScript(() => {
    const blocked = () => { throw new DOMException("blocked", "SecurityError"); };
    Object.defineProperty(window, "localStorage", { configurable: true, get: blocked });
  });
  await page.goto("/pro-meta-intelligence/");
  await enterDraftForReview(page);
  await page.getByRole("button", { name: "테스트 의견 남기기", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "테스트 의견 남기기" });
  await dialog.getByRole("group", { name: "다시 써볼 생각이 있나요?" }).getByLabel("또 써볼 것 같다").check();
  await expect(dialog.getByText("작성 내용을 임시 보관할 수 없어요", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "의견 복사", exact: true })).toBeEnabled();
});

test("a finished set offers feedback; both entry points share one local draft", async ({ page }) => {
  await page.goto("/pro-meta-intelligence/");
  await enterDraftForReview(page);
  const prompt = page.locator(".tester-feedback-prompt");
  await expect(prompt).toHaveCount(0);
  for (let turn = 0; turn < 20; turn++) {
    await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
    await page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ }).click();
  }
  await expect(prompt).toContainText("한 세트 끝! 써보니 어땠나요?");
  await prompt.getByRole("button", { name: "테스트 의견 남기기" }).click();
  const first = page.getByRole("dialog", { name: "테스트 의견 남기기" });
  await expect(first).toHaveCount(1);
  await first.getByLabel("바로 알았다").check();
  await expect(first.getByRole("list", { name: "함께 붙는 화면 상태" })).toContainText("현재 세트 20/20 차례");
  await first.getByRole("button", { name: "의견 창 닫기" }).click();

  await page.locator("footer.studio-preview-footer").getByRole("button", { name: "테스트 의견 남기기" }).click();
  const second = page.getByRole("dialog", { name: "테스트 의견 남기기" });
  await expect(second.getByLabel("바로 알았다")).toBeChecked();
  await second.getByLabel("상황 따라").check();
  await page.keyboard.press("Escape");

  await prompt.getByRole("button", { name: "테스트 의견 남기기" }).click();
  await expect(page.getByRole("dialog", { name: "테스트 의견 남기기" }).getByLabel("상황 따라")).toBeChecked();
});
