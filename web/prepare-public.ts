import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(webRoot, "public");
const targetRoot = resolve(webRoot, ".site-public");
const publishedFiles = [
  "meta-radar-hero-v2.png",
  "og.png",
  "feed/current.json",
  "feed/history-status.json",
  "feed/schedule.json",
  "feed/current-creator.json",
  "feed/index.json",
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
