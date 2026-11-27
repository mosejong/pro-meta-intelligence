import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const pages = ["static-site/index.html", ...readdirSync(new URL("static-site/", root), { withFileTypes: true })
  .filter((d) => d.isDirectory()).map((d) => `static-site/${d.name}/index.html`)]
  .filter((p) => existsSync(new URL(p, root)));

test("every page links the favicon, touch icon, manifest and theme color", () => {
  assert.ok(pages.length >= 7);
  for (const page of pages) {
    const html = readFileSync(new URL(page, root), "utf8");
    for (const tag of ['rel="icon" href="/icon.svg"', 'rel="apple-touch-icon" href="/apple-touch-icon.png"', 'rel="manifest" href="/manifest.webmanifest"', 'name="theme-color"']) {
      assert.ok(html.includes(tag), `${page} has ${tag}`);
    }
  }
});

test("the manifest is valid and its icons are published", () => {
  const manifest = JSON.parse(readFileSync(new URL("public/manifest.webmanifest", root), "utf8"));
  assert.equal(manifest.start_url, "/pro-meta-intelligence/");
  assert.equal(manifest.display, "standalone");
  const published = readFileSync(new URL("prepare-public.ts", root), "utf8");
  for (const file of ["icon.svg", "apple-touch-icon.png", "manifest.webmanifest", ...manifest.icons.map((i) => i.src)]) {
    assert.ok(existsSync(new URL(`public/${file}`, root)), `${file} exists`);
    assert.ok(published.includes(`"${file}"`), `${file} is in the publish allowlist`);
  }
});
