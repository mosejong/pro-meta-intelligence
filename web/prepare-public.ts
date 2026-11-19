import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(webRoot, "public");
const targetRoot = resolve(webRoot, ".site-public");
const publishedFiles = [
  "meta-radar-hero-v2.png",
  "og.png",
  "briefs/worlds-strategy-brief.pdf",
  "feed/current.json",
  "feed/collection-status.json",
  "feed/history-status.json",
  "feed/decision-outcomes.json",
  "feed/ai-validation.json",
  "feed/schedule.json",
  "feed/schedule-changes.json",
  "feed/current-creator.json",
  "feed/index.json",
  // Derived per-player season aggregate only (no raw rows); loaded on demand by the draft studio.
  "history/player-season-2026.json",
  "history/season-player-cards.json",
  // Reviewed immutable aggregate retained for saved-practice restoration (never raw archives).
  "history/catalogs/b0f5e81bc19120632147dec7913ffd2c772aa17e63590e8b5570392a4e04c304.json",
  "history/catalogs/f2c8e725b267ad9fb0ff1ca5770888008c07b341c8cb2a17e53703d3ee5a8621.json",
];

export function preparePublishedAssets() {
  for (const relativePath of publishedFiles) {
    const source = resolve(sourceRoot, relativePath);
    if (!existsSync(source)) continue;
    const target = resolve(targetRoot, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  return targetRoot;
}
