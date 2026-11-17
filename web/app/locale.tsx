"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_LOCALE,
  formatMessage,
  htmlLangFor,
  isLocale,
  LOCALE_LABELS,
  readStoredLocale,
  SUPPORTED_LOCALES,
  translateMessage,
  writeStoredLocale,
  type Locale,
  type MessageKey,
  type MessageParams,
  type TemplateKey,
} from "./locale-messages";

export { DEFAULT_LOCALE, isLocale, LOCALE_LABELS, SUPPORTED_LOCALES, type Locale, type MessageKey, type MessageParams, type TemplateKey };

/** Typed `{param}` substitution; returns plain text for React text nodes / attributes, never HTML. */
export type FormatMessage = <K extends TemplateKey>(key: K, params: MessageParams<K>) => string;

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey) => string;
  format: FormatMessage;
};

const translate = (locale: Locale) => (key: MessageKey) => translateMessage(locale, key);
const formatter = (locale: Locale): FormatMessage => (key, params) => formatMessage(locale, key, params);

/** Translators for a fixed locale, for components that take an explicit `locale` prop. */
export function messagesFor(locale: Locale) {
  return { t: translate(locale), format: formatter(locale) };
}

// Outside a provider (isolated renders, tests) the UI stays Korean and selection is a no-op.
const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  ...messagesFor(DEFAULT_LOCALE),
});

/** Even reading `window.localStorage` can throw (SecurityError) when storage is blocked. */
function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Server render and first client render always use `initialLocale` (Korean by default),
 * so hydration markup matches. The saved preference is applied only after hydration.
 * Changing locale updates context only; it never changes the child tree shape, so
 * mounted children (the draft session, timers, open tabs) are not remounted.
 */
export function LocaleProvider({ children, initialLocale = DEFAULT_LOCALE }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(isLocale(initialLocale) ? initialLocale : DEFAULT_LOCALE);
  const userChose = useRef(false);

  useEffect(() => {
    const stored = readStoredLocale(browserStorage());
    if (!stored) return;
    // Deferred like the champion-name cache restore: keeps setState out of the effect body.
    const restore = window.setTimeout(() => {
      if (!userChose.current) setLocaleState(stored);
    }, 0);
    return () => window.clearTimeout(restore);
  }, []);

  useEffect(() => {
    document.documentElement.lang = htmlLangFor(locale);
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) return;
    userChose.current = true;
    setLocaleState(next);
    writeStoredLocale(browserStorage(), next);
  }, []);

  const value = useMemo(() => ({ locale, setLocale, ...messagesFor(locale) }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}

export function LanguageSelector({ className }: { className?: string }) {
  const { locale, setLocale, t } = useLocale();
  return <label className={className ?? "locale-select"} lang={locale}>
    <span>{t("locale.selectorLabel")}</span>
    <select value={locale} onChange={(event) => { const next = event.target.value; if (isLocale(next)) setLocale(next); }}>
      {SUPPORTED_LOCALES.map((option) => <option key={option} value={option} lang={option}>{LOCALE_LABELS[option]}</option>)}
    </select>
  </label>;
}
