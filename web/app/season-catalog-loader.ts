import { fetchJsonWithTimeout } from "./publication-loader";
import { isCardHash, parseSeasonCardCatalog, verifySeasonCardIntegrity, type SeasonCardCatalog } from "./season-player-cards";

/** Version a saved practice was built against; only an exact catalog_id + cutoff match is accepted. */
export type ExpectedSeasonCatalog = { catalog_id: string; cutoff: string };
/** Test seams: non-network fetch and a base href instead of window.location. */
export type SeasonCatalogLoaderOptions = { fetchImpl?: typeof fetch; baseHref?: string; timeoutMs?: number };

const timezoneAware = (x: unknown): x is string => typeof x === "string" && /(?:Z|[+-]\d\d:\d\d)$/.test(x) && Number.isFinite(Date.parse(x));
const aborted = () => new DOMException("aborted", "AbortError");
const isAbort = (error: unknown, signal: AbortSignal) => signal.aborted || (error instanceof DOMException && error.name === "AbortError");
const matches = (catalog: SeasonCardCatalog, expected: ExpectedSeasonCatalog) => catalog.catalog_id === expected.catalog_id && catalog.cutoff === expected.cutoff;

const fetchRaw = (url: URL, signal: AbortSignal, options: SeasonCatalogLoaderOptions) =>
  fetchJsonWithTimeout(url, { signal, timeoutMs: options.timeoutMs ?? 15000, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });

async function verify(data: unknown, signal: AbortSignal): Promise<SeasonCardCatalog> {
  const parsed = parseSeasonCardCatalog(data);
  await verifySeasonCardIntegrity(parsed);
  if (signal.aborted) throw aborted();
  return parsed;
}

/**
 * Load the published season-player-cards catalog with the same steps as the season lineup panel:
 * bounded fetch, strict structural parse, then sha-256 integrity check. Throws on any failure
 * (offline, timeout, abort, malformed, tampered); callers keep their current state.
 *
 * With `expected`, the current catalog is returned only on an exact catalog_id + cutoff match.
 * Otherwise (or when the current request fails for a non-abort reason) exactly one immutable
 * archive under the same publication root is tried: history/catalogs/<catalog_id>.json, which must
 * itself parse, verify and match exactly. Never more than two requests; abort never falls back.
 */
export async function loadPublishedSeasonCatalog(publicationRoot: string, signal: AbortSignal, expected?: ExpectedSeasonCatalog | null, options: SeasonCatalogLoaderOptions = {}): Promise<SeasonCardCatalog> {
  if (expected != null && (!isCardHash(expected.catalog_id) || !timezoneAware(expected.cutoff))) throw new Error("저장된 시즌 선수 자료 버전 정보가 올바르지 않아 불러오지 않았습니다.");
  if (signal.aborted) throw aborted();
  const base = options.baseHref ?? window.location.href;
  const root = new URL(publicationRoot.endsWith("/") ? publicationRoot : publicationRoot + "/", base);
  const currentUrl = new URL("history/season-player-cards.json", root);

  let current: SeasonCardCatalog | null = null;
  let data: unknown;
  let fetched = false;
  try {
    data = await fetchRaw(currentUrl, signal, options);
    fetched = true;
  } catch (error) {
    // Only transport failures (offline, timeout, HTTP error such as 404) may fall back, and only
    // with a valid expected version. Abort never falls back.
    if (isAbort(error, signal) || !expected) throw error;
  }
  // A malformed or tampered current catalog is reported as-is, never silently replaced.
  if (fetched) current = await verify(data, signal);
  if (current && (!expected || matches(current, expected))) return current;
  if (!expected) throw new Error("시즌 선수 자료를 확인하지 못했습니다.");

  // catalog_id is a verified 64-char lowercase hex string, so no path segments can be injected.
  const archiveUrl = new URL(`history/catalogs/${expected.catalog_id}.json`, root);
  if (archiveUrl.origin !== root.origin || !archiveUrl.pathname.startsWith(root.pathname)) throw new Error("저장 당시 시즌 선수 자료 위치를 확인하지 못했습니다.");
  let archivedData: unknown;
  try {
    archivedData = await fetchRaw(archiveUrl, signal, options);
  } catch (error) {
    if (isAbort(error, signal)) throw error;
    throw new Error("저장 당시 버전의 시즌 선수 자료를 찾지 못했습니다. 현재 밴픽과 선수 구성은 그대로 유지합니다.");
  }
  const archived = await verify(archivedData, signal);
  if (!matches(archived, expected)) throw new Error("보존된 시즌 선수 자료가 저장 당시 버전과 정확히 일치하지 않습니다.");
  return archived;
}
