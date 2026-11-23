import { test, expect } from "@playwright/test";
import { enterDraftForReview } from "./enter-draft-review.mjs";

// Independent review: an async saved-practice read must not discard work started after the click.
test("a delayed library load preserves a champion staged while the read is in flight", async ({ page }) => {
  await page.goto("/pro-meta-intelligence/");
  const picker = page.locator(".draft-picker-grid button:not(:disabled)");
  const progress = page.locator(".draft-turn-progress");
  const lockIn = page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ });
  await expect(picker.first()).toBeEnabled();
  await picker.first().click(); await lockIn.click();
  await expect(progress).toHaveAttribute("value", "1");
  const library = page.locator("details.draft-practice-library");
  await library.locator("summary").click();
  await library.getByLabel("연습 이름", { exact: true }).fill("비동기 복원 검증");
  await expect(library.getByRole("button", { name: "이 연습 저장", exact: true })).toBeEnabled();
  await library.getByRole("button", { name: "이 연습 저장", exact: true }).click();
  await expect(library.getByRole("button", { name: "비동기 복원 검증 열기", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "현재 세트 초기화", exact: true }).click();
  await page.getByRole("dialog", { name: "현재 세트를 초기화할까요?", exact: true }).getByRole("button", { name: "초기화", exact: true }).click();
  await expect(progress).toHaveAttribute("value", "0");
  await page.evaluate(() => {
    const original = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function(name, ...args) {
      const request = original.call(this, name, ...args);
      if (name !== "pro-meta-practice-library") return request;
      const proxy = {};
      for (const key of ["result", "error", "transaction"]) Object.defineProperty(proxy, key, { get: () => request[key] });
      for (const key of ["onerror", "onblocked", "onupgradeneeded"]) Object.defineProperty(proxy, key, { set: handler => { request[key] = handler; } });
      Object.defineProperty(proxy, "onsuccess", { set: handler => { request.onsuccess = event => setTimeout(() => handler.call(proxy, event), 1200); } });
      return proxy;
    };
  });
  await library.getByRole("button", { name: "비동기 복원 검증 열기", exact: true }).click();
  await expect(library.locator(".draft-practice-list")).toHaveAttribute("aria-busy", "true");
  await picker.first().click();
  await expect(lockIn).toBeEnabled();
  await expect(library.locator(".draft-practice-list")).toHaveAttribute("aria-busy", "false");
  await expect(progress).toHaveAttribute("value", "0");
  await expect(lockIn).toBeEnabled();
});


test("real IndexedDB serializes two tabs racing for the fifth saved practice", async ({ page, context }, testInfo) => {
  await page.goto("/pro-meta-intelligence/");
  const picker = page.locator(".draft-picker-grid button:not(:disabled)");
  await expect(picker.first()).toBeEnabled(); await picker.first().click();
  await page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ }).click();
  const library = page.locator("details.draft-practice-library");
  await library.locator("summary").click();
  for (let i = 1; i <= 4; i++) {
    await library.getByLabel("연습 이름", { exact: true }).fill(`보관 ${i}`);
    await expect(library.getByRole("button", { name: "이 연습 저장", exact: true })).toBeEnabled();
    await library.getByRole("button", { name: "이 연습 저장", exact: true }).click();
    await expect(library.getByRole("button", { name: `보관 ${i} 열기`, exact: true })).toBeEnabled();
  }
  const other = await context.newPage(); await other.goto("/pro-meta-intelligence/");
  await enterDraftForReview(other);
  const second = other.locator("details.draft-practice-library");
  await second.locator("summary").click();
  await library.getByLabel("연습 이름", { exact: true }).fill("다섯 번째 A");
  await second.getByLabel("연습 이름", { exact: true }).fill("다섯 번째 B");
  await expect(library.getByRole("button", { name: "이 연습 저장", exact: true })).toBeEnabled();
  await expect(second.getByRole("button", { name: "이 연습 저장", exact: true })).toBeEnabled();
  await Promise.all([library.getByRole("button", { name: "이 연습 저장", exact: true }).click(), second.getByRole("button", { name: "이 연습 저장", exact: true }).click()]);
  for (const panel of [library, second]) await expect(panel.locator(".draft-practice-list")).toHaveAttribute("aria-busy", "false");
  const names = await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open("pro-meta-practice-library", 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, read = db.transaction("entries", "readonly").objectStore("entries").getAll();
      read.onsuccess = () => { db.close(); resolve(read.result.map(entry => entry.name)); };
      read.onerror = () => { db.close(); reject(read.error); };
    };
  }));
  expect(names).toHaveLength(5);
  expect(names.filter(name => ["다섯 번째 A", "다섯 번째 B"].includes(name))).toHaveLength(1);
  for (let i = 1; i <= 4; i++) expect(names).toContain(`보관 ${i}`);
  await expect(page.locator(".draft-turn-progress")).toHaveAttribute("value", "1");
  await expect(other.locator(".draft-turn-progress")).toHaveAttribute("value", "1");
  await library.screenshot({ path: testInfo.outputPath("practice-library.png") });
});
