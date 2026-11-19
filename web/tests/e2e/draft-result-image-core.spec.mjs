import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("PNG download renders explicit positions and creates a real local PNG", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    window.__resultCanvasText = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      window.__resultCanvasText.push(String(text));
      return original.call(this, text, ...args);
    };
  });
  await page.goto("/pro-meta-intelligence/");
  await expect(page.getByRole("button", { name: "밴픽 링크 복사", exact: true })).toBeEnabled();
  for (let i = 0; i < 20; i++) {
    await page.locator(".draft-picker-grid button:not(:disabled)").first().click();
    await page.locator(".draft-lock-in").getByRole("button", { name: /^(밴|픽) 확정$/ }).click();
  }
  const board = page.locator(".draft-position-board[aria-label=\"블루 포지션 배정\"]");
  await board.locator("article[data-champion-id] select").first().selectOption("SUPPORT");
  const downloadReady = page.waitForEvent("download");
  await page.getByRole("button", { name: "밴픽 결과 이미지 저장", exact: true }).click();
  const download = await downloadReady;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const file = testInfo.outputPath("draft-result.png");
  await download.saveAs(file);
  const bytes = await readFile(file);
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(bytes.readUInt32BE(16)).toBe(1080);
  expect(bytes.readUInt32BE(20)).toBeGreaterThan(1000);
  const text = await page.evaluate(() => window.__resultCanvasText);
  expect(text.some(line => line.includes("서포터"))).toBeTruthy();
  expect(text.some(line => line.includes("미배정"))).toBeTruthy();
  expect(text.some(line => line.includes("승패 예측 아님"))).toBeTruthy();
  expect(await download.failure()).toBeNull();
});
