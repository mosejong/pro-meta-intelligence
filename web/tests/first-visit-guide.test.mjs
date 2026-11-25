import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("the setup step shows a dismissible first-visit guide", async () => {
  const guide = await readFile(new URL("../app/first-visit-guide.tsx", import.meta.url), "utf8");
  const lab = await readFile(new URL("../app/draft-lab.tsx", import.meta.url), "utf8");
  assert.match(guide, /FIRST_VISIT_GUIDE_KEY = "pmi\.firstVisitGuide\.dismissed"/);
  assert.match(guide, /try \{ globalThis\.localStorage/, "storage access is guarded");
  assert.match(guide, /알겠어요/);
  assert.match(lab, /\{!resuming && <FirstVisitGuide \/>\}/, "hidden while resuming a draft");
});
