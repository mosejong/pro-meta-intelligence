import { fetchJsonWithTimeout } from "./publication-loader";
import { parseSeasonCardCatalog, verifySeasonCardIntegrity, type SeasonCardCatalog } from "./season-player-cards";

/**
 * Load the currently published season-player-cards catalog with the same steps as the season lineup
 * panel: bounded fetch, strict structural parse, then sha-256 integrity check. Throws on any failure
 * (offline, timeout, abort, malformed, tampered); callers keep their current state.
 */
export async function loadPublishedSeasonCatalog(publicationRoot: string, signal: AbortSignal): Promise<SeasonCardCatalog> {
  const url = new URL(`${publicationRoot.endsWith("/") ? publicationRoot : publicationRoot + "/"}history/season-player-cards.json`, window.location.href);
  const data = await fetchJsonWithTimeout(url, { signal, timeoutMs: 15000 });
  const parsed = parseSeasonCardCatalog(data);
  await verifySeasonCardIntegrity(parsed);
  if (signal.aborted) throw new DOMException("aborted", "AbortError");
  return parsed;
}
