"use client";

import { useEffect, useMemo, useState } from "react";
import type { RadarReport } from "./radar-types";
import { basisKey, rosterBasis } from "./roster-scenario";
import { loadPlayerSeasonHistory, PLAYER_SEASON_PATH, PLAYER_SEASON_YEAR, type SeasonHistory } from "./player-season-history";

/** Optional local companion: stale/failed files never stop practice indefinitely. */
export function useSoloSeasonHistory(report: RadarReport, publicationRoot: string, enabled: boolean) {
  const basis = useMemo(() => rosterBasis(report), [report]);
  const key = `${publicationRoot}|${basisKey(basis)}`;
  const [loaded, setLoaded] = useState<{ key: string; history: SeasonHistory | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!enabled || loaded?.key === key) return;
    const request = new AbortController();
    const url = new URL(PLAYER_SEASON_PATH, new URL(publicationRoot, document.baseURI));
    loadPlayerSeasonHistory(url, { basis, season: PLAYER_SEASON_YEAR }, request.signal).then(result => {
      if (request.signal.aborted) return;
      setLoaded({ key, history: result.ok ? result.value : null, error: result.ok ? null : result.error });
    }).catch(() => {
      if (!request.signal.aborted) setLoaded({ key, history: null, error: "시즌 자료를 확인하지 못했습니다." });
    });
    return () => request.abort();
  }, [enabled, key, basis, publicationRoot, loaded?.key]);
  const current = enabled && loaded?.key === key ? loaded : null;
  return { history: current?.history ?? null, loading: enabled && !current, error: current?.error ?? null };
}
