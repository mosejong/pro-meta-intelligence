/**
 * Marks champion portraits from Riot Data Dragon that fail to load (blocked or slow CDN, ad blockers,
 * regions with poor access) so CSS can swap the browser's broken-image icon for a neutral placeholder.
 * One capture-phase listener covers every <img>; a later successful load clears the mark, so a reused
 * element whose src changes is never left marked.
 */
export const ASSET_HOST = "ddragon.leagueoflegends.com";
export const FAILED_ATTRIBUTE = "data-asset-failed";

function isPortrait(target: EventTarget | null): target is HTMLImageElement {
  return typeof HTMLImageElement !== "undefined" && target instanceof HTMLImageElement && target.src.includes(ASSET_HOST);
}

export function installAssetFallback(doc: Document = document): () => void {
  const onError = (event: Event) => { if (isPortrait(event.target)) event.target.setAttribute(FAILED_ATTRIBUTE, ""); };
  const onLoad = (event: Event) => { if (isPortrait(event.target)) event.target.removeAttribute(FAILED_ATTRIBUTE); };
  doc.addEventListener("error", onError, true);
  doc.addEventListener("load", onLoad, true);
  // Images that already failed before the listener was installed (complete with no pixels).
  for (const img of Array.from(doc.images)) if (img.src.includes(ASSET_HOST) && img.complete && img.naturalWidth === 0) img.setAttribute(FAILED_ATTRIBUTE, "");
  return () => { doc.removeEventListener("error", onError, true); doc.removeEventListener("load", onLoad, true); };
}
