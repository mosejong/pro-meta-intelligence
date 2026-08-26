"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { championAssetId, championCatalogUrl, DATA_DRAGON_VERSION } from "./champion-assets";

export type ChampionNameCatalog = Record<string, string>;

const STORAGE_KEY = `pro-meta:champion-names:ko_KR:${DATA_DRAGON_VERSION}`;

// Immediate, offline-safe names for champions currently used by the checked-in feed.
// The official Data Dragon catalog fills in every other champion after hydration.
export const fallbackChampionNames: ChampionNameCatalog = {
  Ahri: "아리",
  Azir: "아지르",
  DrMundo: "문도 박사",
  Mundo: "문도 박사",
  RekSai: "렉사이",
  Rell: "렐",
  Rumble: "럼블",
  Vi: "바이",
  Zyra: "자이라",
};

type ChampionCatalogPayload = {
  data?: Record<string, { id?: unknown; name?: unknown }>;
};

export function parseChampionNameCatalog(payload: unknown): ChampionNameCatalog {
  if (!payload || typeof payload !== "object") return {};
  const data = (payload as ChampionCatalogPayload).data;
  if (!data || typeof data !== "object") return {};

  return Object.entries(data).reduce<ChampionNameCatalog>((catalog, [assetId, entry]) => {
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || typeof entry.name !== "string") {
      return catalog;
    }
    const name = entry.name.trim();
    if (!name) return catalog;
    catalog[assetId] = name;
    catalog[entry.id] = name;
    return catalog;
  }, {});
}

export function championDisplayName(championId: string, catalog: ChampionNameCatalog = fallbackChampionNames) {
  return catalog[championId] ?? catalog[championAssetId(championId)] ?? fallbackChampionNames[championId] ?? fallbackChampionNames[championAssetId(championId)] ?? championId;
}

function normalizedSearchValue(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[^\p{L}\p{N}]/gu, "");
}

export function matchesChampionQuery(championId: string, query: string, catalog: ChampionNameCatalog = fallbackChampionNames) {
  const needle = normalizedSearchValue(query.trim());
  if (!needle) return true;
  return [championId, championAssetId(championId), championDisplayName(championId, catalog)]
    .some((candidate) => normalizedSearchValue(candidate).includes(needle));
}

type ChampionNamesContextValue = {
  catalog: ChampionNameCatalog;
  nameOf: (championId: string) => string;
  matches: (championId: string, query: string) => boolean;
};

const ChampionNamesContext = createContext<ChampionNamesContextValue>({
  catalog: fallbackChampionNames,
  nameOf: (championId) => championDisplayName(championId),
  matches: (championId, query) => matchesChampionQuery(championId, query),
});

export function ChampionNameProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<ChampionNameCatalog>(fallbackChampionNames);

  useEffect(() => {
    let active = true;
    try {
      const cached = window.localStorage.getItem(STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as ChampionNameCatalog;
        if (parsed && typeof parsed === "object") {
          window.setTimeout(() => {
            if (active) setCatalog({ ...fallbackChampionNames, ...parsed });
          }, 0);
        }
      }
    } catch {
      // Privacy modes may deny storage. The network catalog can still load.
    }

    fetch(championCatalogUrl("ko_KR"))
      .then((response) => {
        if (!response.ok) throw new Error(`Champion catalog request failed: ${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        const parsed = parseChampionNameCatalog(payload);
        if (!Object.keys(parsed).length) throw new Error("Champion catalog was empty");
        if (active) setCatalog({ ...fallbackChampionNames, ...parsed });
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
        } catch {
          // A full storage area must not block the public dashboard.
        }
      })
      .catch(() => {
        // Keep the bounded local fallback. Champion IDs remain readable.
      });

    return () => { active = false; };
  }, []);

  const nameOf = useCallback((championId: string) => championDisplayName(championId, catalog), [catalog]);
  const matches = useCallback((championId: string, query: string) => matchesChampionQuery(championId, query, catalog), [catalog]);
  const value = useMemo(() => ({ catalog, nameOf, matches }), [catalog, matches, nameOf]);

  return <ChampionNamesContext.Provider value={value}>{children}</ChampionNamesContext.Provider>;
}

export function useChampionNames() {
  return useContext(ChampionNamesContext);
}
