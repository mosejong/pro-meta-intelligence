import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

const root = "/pro-meta-intelligence/radar/";
const feed = JSON.parse(readFileSync(new URL("../../public/feed/current.json", import.meta.url), "utf8"));
const local = { name: "valid.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...feed, patch_id: "LOCAL.9" })) };
const badge = (page) => page.locator(".snapshot-state");
const upload = (page) => page.getByLabel("Meta Radar JSON 불러오기");

test("an old invalid read cannot relabel a newer valid local report", async ({ page }) => {
  await page.addInitScript(() => {
    const original = File.prototype.text;
    File.prototype.text = function () {
      if (this.name === "slow.json") return new Promise((resolve) => { window.releaseOldRead = () => resolve("invalid JSON"); });
      return original.call(this);
    };
  });
  await page.goto(root);
  await expect(badge(page)).not.toHaveText("FEED CONNECTING");
  await upload(page).setInputFiles({ name: "slow.json", mimeType: "application/json", buffer: Buffer.from("bad") });
  await expect.poll(() => page.evaluate(() => typeof window.releaseOldRead)).toBe("function");
  await upload(page).setInputFiles(local);
  await expect(badge(page)).toHaveText("LOCAL FILE");
  await page.evaluate(() => window.releaseOldRead());
  await expect(page.locator(".kicker-row .eyebrow")).toContainText("LOCAL.9");
  await expect(badge(page)).toHaveText("LOCAL FILE");
});

test("invalid and oversized reports preserve the current data and its source kind", async ({ page }) => {
  await page.goto(root);
  await upload(page).setInputFiles(local);
  await expect(badge(page)).toHaveText("LOCAL FILE");
  for (const buffer of [Buffer.from("invalid"), Buffer.alloc(16 * 1024 * 1024 + 1, 32)]) {
    await upload(page).setInputFiles({ name: "bad.json", mimeType: "application/json", buffer });
    await expect(badge(page)).toHaveText("INVALID LOCAL FILE");
    await expect(badge(page)).toHaveClass(/uploaded/);
    await expect(page.locator(".kicker-row .eyebrow")).toContainText("LOCAL.9");
  }
});
