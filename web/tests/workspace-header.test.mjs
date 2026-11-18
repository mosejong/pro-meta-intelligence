import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("shared header SSR preserves routes, locale, active resources and the main return link", async () => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { WorkspaceHeader } = await vite.ssrLoadModule("/app/workspace-header.tsx");
    const { LocaleProvider } = await vite.ssrLoadModule("/app/locale.tsx");
    const { MESSAGES } = await vite.ssrLoadModule("/app/locale-messages.ts");
    const render = (space, locale = "ko") => renderToStaticMarkup(createElement(LocaleProvider, { initialLocale: locale },
      createElement(WorkspaceHeader, { currentSpace: space }, createElement("button", { type: "button" }, "Refresh report"))));
    for (const space of ["ONBOARDING", "DRAFT", "TEAM", "RADAR", "CREATOR", "PROOF", "T1"]) {
      for (const locale of ["ko", "zh-CN"]) {
        const html = render(space, locale);
        const m = MESSAGES[locale];
        const base = space === "ONBOARDING" ? "https://example.test/nested/" : `https://example.test/nested/${space.toLowerCase()}/`;
        assert.match(html, /class="workspace-header"/);
        assert.ok(html.includes(`aria-label="${m["draft.pagesLabel"]}"`));
        assert.ok(html.includes(`lang="${locale}"`));
        assert.match(html, /<details class="workspace-resources"[^>]*>/);
        assert.doesNotMatch(html, /<details[^>]*\sopen(?:[ =>])/);
        assert.match(html, /<button type="button">Refresh report<\/button>/);
        const main = html.match(/<a class="workspace-primary"[^>]*>([^<]+)<\/a>/)?.[0];
        assert.ok(main?.includes(m["space.DRAFT"]), "clear localized main return link outside details");
        const mainHref = main.match(/href="([^"]+)"/)[1];
        assert.equal(new URL(mainHref, base).pathname, space === "ONBOARDING" ? "/nested/" : "/nested/draft/");
        const rootBase = space === "ONBOARDING" ? "https://example.test/" : `https://example.test/${space.toLowerCase()}/`;
        assert.equal(new URL(mainHref, rootBase).pathname, space === "ONBOARDING" ? "/" : "/draft/");
        assert.equal(main.includes('aria-current="page"'), ["ONBOARDING", "DRAFT"].includes(space));
        const menu = html.match(/<div class="workspace-resource-menu">([\s\S]*?)<\/div>/)[1];
        for (const resource of ["TEAM", "RADAR", "CREATOR", "PROOF"]) {
          const link = menu.match(new RegExp(`<a href="([^"]+)"([^>]*)>${m[`space.${resource}`]}</a>`));
          assert.ok(link, `${space}: ${resource} is server-rendered`);
          assert.equal(new URL(link[1], base).pathname, `/nested/${resource.toLowerCase()}/`);
          assert.equal(new URL(link[1], rootBase).pathname, `/${resource.toLowerCase()}/`);
          assert.equal(link[2].includes('aria-current="page"'), (space === "T1" ? "TEAM" : space) === resource);
        }
        if (!["ONBOARDING", "DRAFT"].includes(space)) {
          assert.match(html, /data-active="true"/);
          assert.ok(html.match(/<summary>([\s\S]*?)<\/summary>/)[1].includes(m[`space.${space === "T1" ? "TEAM" : space}`]));
        }
        if (locale === "ko") assert.match(html, /연구 자료[\s\S]*상대 분석·메타·검증 자료/);
        else assert.doesNotMatch(html, /[가-힣]/);
      }
    }
  } finally { await vite.close(); }
});
