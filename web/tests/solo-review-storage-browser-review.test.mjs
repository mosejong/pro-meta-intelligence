import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "@playwright/test";

test("native browser IndexedDB commits matching pairs, rolls back aborts and clears legacy notes", { timeout: 90000 }, async () => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, logLevel: "silent", server: { host: "127.0.0.1", port: 0 } });
  let browser;
  try {
    await vite.listen();
    const origin = vite.resolvedUrls.local[0];
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route("**/__codex_storage_review", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Native storage review</title>" }));
    await page.goto(new URL("/__codex_storage_review", origin).href);
    const result = await page.evaluate(async () => {
      const storage = await import("/app/draft-session.ts");
      await storage.writeLocalDraftWithReview("board-1", "review-1");
      const first = await storage.readLocalDraftWithReview();
      await storage.writeLocalDraft("board-1");
      const legacy = await storage.readLocalDraftWithReview();
      await Promise.all([
        storage.writeLocalDraftWithReview("board-2", "review-2"),
        storage.writeLocalDraft("board-3"),
        storage.writeLocalDraftWithReview("board-4", "review-4"),
      ]);
      const queued = await storage.readLocalDraftWithReview();

      // Real browser request failure/rollback, injected via duplicate add rather than actual disk quota.
      // The sidecar key already exists: add() raises an asynchronous ConstraintError and aborts the tx.
      const originalPut = IDBObjectStore.prototype.put;
      let injected = 0;
      IDBObjectStore.prototype.put = function(value, key) {
        if (key === storage.SOLO_REVIEW_KEY) {
          injected++;
          return this.add(value, key);
        }
        return originalPut.call(this, value, key);
      };
      try { await storage.writeLocalDraftWithReview("board-5", "review-5"); }
      finally { IDBObjectStore.prototype.put = originalPut; }
      const fallback = await storage.readLocalDraftWithReview();

      // Synchronous setup failures are deliberately not retried: their partial writes must roll back.
      IDBObjectStore.prototype.put = function(value, key) {
        if (key === storage.SOLO_REVIEW_KEY) throw new DOMException("injected setup failure", "QuotaExceededError");
        return originalPut.call(this, value, key);
      };
      let setupRejected = false;
      try { await storage.writeLocalDraftWithReview("must-not-commit", "review-6"); }
      catch { setupRejected = true; }
      finally { IDBObjectStore.prototype.put = originalPut; }
      const rollback = await storage.readLocalDraftWithReview();
      await storage.writeLocalDraftWithReview("board-7", "review-7");
      const recovered = await storage.readLocalDraftWithReview();
      return { first, legacy, queued, fallback, injected, setupRejected, rollback, recovered };
    });
    assert.deepEqual(result.first, { scenario: "board-1", review: "review-1" });
    assert.deepEqual(result.legacy, { scenario: "board-1", review: null });
    assert.deepEqual(result.queued, { scenario: "board-4", review: "review-4" });
    assert.equal(result.injected, 1, "exactly one failing request before board-only fallback");
    assert.deepEqual(result.fallback, { scenario: "board-5", review: null });
    assert.equal(result.setupRejected, true);
    assert.deepEqual(result.rollback, result.fallback, "failed setup cannot commit its queued board put");
    assert.deepEqual(result.recovered, { scenario: "board-7", review: "review-7" });

    // Two real pages share native storage but have separate module instances / writer queues.
    const peer = await page.context().newPage();
    await peer.route("**/__codex_storage_review", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Peer storage review</title>" }));
    await peer.goto(new URL("/__codex_storage_review", origin).href);
    assert.deepEqual(await peer.evaluate(async () => (await import("/app/draft-session.ts")).readLocalDraftWithReview()), result.recovered);
    await page.evaluate(async () => (await import("/app/draft-session.ts")).writeLocalDraftWithReview("initial", "note:initial"));
    const observations = await Promise.all([page, peer].map((tab, index) => tab.evaluate(async writer => {
      const storage = await import("/app/draft-session.ts");
      const mismatches = [];
      for (let turn = 0; turn < 15; turn++) {
        const scenario = `${writer}:${turn}`;
        await storage.writeLocalDraftWithReview(scenario, `note:${scenario}`);
        const pair = await storage.readLocalDraftWithReview();
        if (pair.review !== `note:${pair.scenario}`) mismatches.push(pair);
      }
      return mismatches;
    }, index)));
    assert.deepEqual(observations, [[], []], "concurrent readers never combine one tab's board with another tab's note");
    const shared = await peer.evaluate(async () => (await import("/app/draft-session.ts")).readLocalDraftWithReview());
    await page.evaluate(async scenario => (await import("/app/draft-session.ts")).writeLocalDraft(scenario), shared.scenario);
    assert.deepEqual(await peer.evaluate(async () => (await import("/app/draft-session.ts")).readLocalDraftWithReview()),
      { scenario: shared.scenario, review: null }, "same-board legacy write clears notes seen by another tab");
  } finally {
    await browser?.close();
    await vite.close();
  }
});
