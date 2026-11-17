import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;

async function withVite(run) {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try { await run(vite); } finally { await vite.close(); }
}

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key) => (data.has(key) ? data.get(key) : null), setItem: (key, value) => { data.set(key, String(value)); }, data };
}

const throwingStorage = {
  getItem() { throw new Error("SecurityError"); },
  setItem() { throw new Error("QuotaExceededError"); },
};

test("locale validation and guarded storage", async () => {
  await withVite(async (vite) => {
    const m = await vite.ssrLoadModule("/app/locale-messages.ts");
    assert.deepEqual([...m.SUPPORTED_LOCALES], ["ko", "zh-CN"]);
    assert.equal(m.DEFAULT_LOCALE, "ko");
    for (const valid of ["ko", "zh-CN"]) assert.equal(m.isLocale(valid), true, valid);
    for (const invalid of ["", "zh", "zh-cn", "zh-TW", "en", "KO", " ko", null, undefined, 1, {}, ["ko"]]) {
      assert.equal(m.isLocale(invalid), false, JSON.stringify(invalid));
    }

    assert.equal(m.readStoredLocale(memoryStorage({ [m.LOCALE_STORAGE_KEY]: "zh-CN" })), "zh-CN");
    assert.equal(m.readStoredLocale(memoryStorage({ [m.LOCALE_STORAGE_KEY]: "ko" })), "ko");
    assert.equal(m.readStoredLocale(memoryStorage({ [m.LOCALE_STORAGE_KEY]: "zh-TW" })), null);
    assert.equal(m.readStoredLocale(memoryStorage({ [m.LOCALE_STORAGE_KEY]: "\"zh-CN\"" })), null);
    assert.equal(m.readStoredLocale(memoryStorage()), null);
    assert.equal(m.readStoredLocale(null), null);
    assert.equal(m.readStoredLocale(throwingStorage), null);

    const storage = memoryStorage();
    assert.equal(m.writeStoredLocale(storage, "zh-CN"), true);
    assert.equal(storage.data.get(m.LOCALE_STORAGE_KEY), "zh-CN");
    assert.equal(m.readStoredLocale(storage), "zh-CN");
    assert.equal(m.writeStoredLocale(storage, "en"), false);
    assert.equal(storage.data.get(m.LOCALE_STORAGE_KEY), "zh-CN", "invalid locale must not overwrite a saved preference");
    assert.equal(m.writeStoredLocale(throwingStorage, "ko"), false);
    assert.equal(m.writeStoredLocale(undefined, "ko"), false);
  });
});

test("ko and zh-CN dictionaries have identical, non-empty keys and no Korean in Chinese", async () => {
  await withVite(async (vite) => {
    const { MESSAGES, LOCALE_LABELS, SUPPORTED_LOCALES } = await vite.ssrLoadModule("/app/locale-messages.ts");
    const koKeys = Object.keys(MESSAGES.ko).sort();
    assert.ok(koKeys.length > 0);
    assert.deepEqual(Object.keys(MESSAGES["zh-CN"]).sort(), koKeys);
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of koKeys) {
        const value = MESSAGES[locale][key];
        assert.equal(typeof value, "string", `${locale}.${key}`);
        assert.ok(value.trim().length > 0, `${locale}.${key} is empty`);
      }
    }
    for (const key of koKeys) assert.doesNotMatch(MESSAGES["zh-CN"][key], HANGUL, `zh-CN.${key} leaks Korean`);
    // Only proper nouns may be identical across locales.
    const identical = koKeys.filter((key) => MESSAGES.ko[key] === MESSAGES["zh-CN"][key]);
    assert.deepEqual(identical, ["nav.t1"]);
    assert.deepEqual(LOCALE_LABELS, { ko: "한국어", "zh-CN": "简体中文" });
  });
});

test("navigation renders Korean by default and Chinese only when the provider is set to zh-CN", async () => {
  await withVite(async (vite) => {
    const { LocaleProvider, LanguageSelector } = await vite.ssrLoadModule("/app/locale.tsx");
    const { AppNavigation } = await vite.ssrLoadModule("/app/app-navigation.tsx");
    const { MESSAGES } = await vite.ssrLoadModule("/app/locale-messages.ts");
    const nav = (props) => createElement(LocaleProvider, props, createElement(AppNavigation, { currentSpace: "DRAFT" }), createElement(LanguageSelector));

    const bare = renderToStaticMarkup(createElement(AppNavigation, { currentSpace: "DRAFT" }));
    const ko = renderToStaticMarkup(nav({}));
    assert.equal(ko, renderToStaticMarkup(nav({ initialLocale: "ko" })) );
    assert.ok(ko.startsWith(bare), "provider default must match the provider-less Korean markup");
    assert.match(ko, /aria-label="주요 메뉴"/);
    assert.match(ko, /<ul aria-label="전체 분석 메뉴">/);
    assert.match(ko, /<select><option value="ko" lang="ko" selected="">한국어<\/option><option value="zh-CN" lang="zh-CN">简体中文<\/option><\/select>/);

    const zh = renderToStaticMarkup(nav({ initialLocale: "zh-CN" }));
    const zhNav = zh.match(/<nav[\s\S]*<\/nav>/)[0];
    assert.match(zhNav, /aria-label="主要菜单"/);
    for (const key of ["nav.draft", "nav.team", "nav.radar", "nav.more", "space.DRAFT", "space.PROOF"]) {
      assert.ok(zhNav.includes(`>${MESSAGES["zh-CN"][key]}<`), key);
    }
    assert.doesNotMatch(zhNav, HANGUL, "translated navigation must not keep Korean labels");
    assert.match(zh, /<option value="zh-CN" lang="zh-CN" selected="">/);
    // Same hrefs and current-page marking in both languages: only labels change.
    const hrefs = (html) => [...html.matchAll(/href="([^"]*)"(?: aria-current="page")?/g)].map((match) => match[0]);
    assert.deepEqual(hrefs(zh), hrefs(ko));

    // An invalid initial locale falls back to Korean instead of rendering missing text.
    assert.equal(renderToStaticMarkup(nav({ initialLocale: "en" })), ko);
  });
});

test("draft header and tabs localize while draft controls, tab wiring and data stay unchanged", async () => {
  await withVite(async (vite) => {
    const { LocaleProvider } = await vite.ssrLoadModule("/app/locale.tsx");
    const { DraftLab } = await vite.ssrLoadModule("/app/draft-lab.tsx");
    const { ChampionNameProvider } = await vite.ssrLoadModule("/app/champion-names.tsx");
    const { sampleReport } = await vite.ssrLoadModule("/app/sample-report.ts");
    const render = (initialLocale) => renderToStaticMarkup(createElement(LocaleProvider, initialLocale ? { initialLocale } : {},
      createElement(ChampionNameProvider, null, createElement(DraftLab, { currentSpace: "DRAFT", report: sampleReport, feedLabel: "TEST FEED" }))));

    const ko = render();
    assert.match(ko, /<h1 lang="ko">모의 밴픽<\/h1>/);
    assert.match(ko, /role="tablist" aria-label="작업실 보기"/);
    assert.doesNotMatch(ko, /studio-locale-note/, "Korean UI needs no partial-translation note");
    assert.match(ko, /<label class="studio-locale-select" lang="ko"><span>언어<\/span><select>/);

    const zh = render("zh-CN");
    assert.match(zh, /<h1 lang="zh-CN">模拟禁选<\/h1>/);
    assert.match(zh, /role="tablist" aria-label="工作区视图"/);
    assert.match(zh, /id="studio-panel-draft-tab"[^>]*>模拟禁选<\/button>/);
    assert.match(zh, /id="studio-panel-details-tab"[^>]*>详细分析<\/button>/);
    // Chinese coverage is incomplete and must say so (and that the rest stays Korean).
    assert.match(zh, /<p class="studio-locale-note" lang="zh-CN" role="note">[^<]*进行中[^<]*韩语[^<]*<\/p>/);
    assert.match(zh, /<label class="studio-locale-select" lang="zh-CN"><span>语言<\/span>/);
    // Bounded scope (B2 translated core draft controls only): champion info, details tab and the
    // A/B comparison panel stay Korean and are not machine-replaced.
    assert.match(zh, /aria-label="챔피언 정보"/);
    assert.match(zh, /aria-label="상세 분석 이동"/);
    assert.match(zh, /<section class="draft-comparison" lang="ko"[^>]*><header><h2 id="draft-comparison-title">드래프트 A\/B 비교<\/h2>/);
    assert.match(zh, /<span lang="ko">아리<\/span>/, "champion display names stay Korean and are marked lang=ko");

    // Translation changes only text and lang/label attributes: markup structure, wiring, links,
    // images and data are identical across locales.
    const skeleton = (html) => html
      .replace(/<header class="studio-workspace-header">[\s\S]*?<\/header>/, "<HEADER/>")
      .replace(/ (lang|aria-label|title|placeholder)="[^"]*"/g, "")
      .replace(/>[^<]*</g, "><");
    assert.equal(skeleton(zh), skeleton(ko));
    const attrs = (html, name) => [...html.matchAll(new RegExp(` ${name}="([^"]*)"`, "g"))].map((match) => match[1]);
    for (const name of ["id", "href", "src", "aria-controls", "aria-labelledby", "value"]) assert.deepEqual(attrs(zh, name), attrs(ko, name), name);
    for (const data of ["PATCH 16.14", "2026-08-15T12:00:00+00:00", "fearless-preview-v2", "Seoul Phoenix"]) {
      assert.ok(ko.includes(data) && zh.includes(data), data);
    }
  });
});
