/** Plain-text download shared by explicit "save as .txt" buttons. */
export const TEXT_DOWNLOAD_TYPE = "text/plain;charset=utf-8";
export type TextDownloadResult = "REQUESTED" | "UNAVAILABLE" | "FAILED";
export type TextDownloadEnv = {
  doc?: Pick<Document, "createElement" | "body">;
  urls?: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
  makeBlob?: (parts: BlobPart[], options: BlobPropertyBag) => Blob;
  schedule?: (run: () => void) => void;
};

/**
 * Asks the browser to download `text` as `fileName` through a Blob URL and one explicit anchor click.
 * "REQUESTED" only means the browser accepted the request; whether the OS actually saved the file is
 * unknown to the page. The anchor is always removed and the URL always revoked (later on success,
 * immediately on failure).
 */
export function requestTextDownload(text: string, fileName: string, env: TextDownloadEnv = {}): TextDownloadResult {
  const doc = env.doc ?? (typeof document !== "undefined" ? document : undefined);
  const urls = env.urls ?? (typeof URL !== "undefined" ? URL : undefined);
  const makeBlob = env.makeBlob ?? (typeof Blob === "function" ? (parts: BlobPart[], options: BlobPropertyBag) => new Blob(parts, options) : undefined);
  const schedule = env.schedule ?? ((run: () => void) => { setTimeout(run, 1000); });
  if (typeof text !== "string" || !text || typeof fileName !== "string" || !fileName || !doc?.body || typeof doc.createElement !== "function" || !makeBlob
    || typeof urls?.createObjectURL !== "function" || typeof urls.revokeObjectURL !== "function") return "UNAVAILABLE";
  let anchor: HTMLAnchorElement;
  try {
    anchor = doc.createElement("a");
    if (typeof anchor.download !== "string" || typeof anchor.click !== "function") return "UNAVAILABLE";
  } catch { return "UNAVAILABLE"; }
  let url: string;
  try { url = urls.createObjectURL(makeBlob([text], { type: TEXT_DOWNLOAD_TYPE })); } catch { return "FAILED"; }
  const revoke = () => { try { urls.revokeObjectURL(url); } catch { /* already gone */ } };
  let clicked = false;
  try {
    anchor.href = url; anchor.download = fileName; anchor.rel = "noopener"; anchor.style.display = "none";
    doc.body.appendChild(anchor);
    anchor.click();
    clicked = true;
  } catch { clicked = false; } finally {
    try { anchor.remove(); } catch { /* not attached */ }
  }
  if (!clicked) { revoke(); return "FAILED"; }
  try { schedule(revoke); } catch { revoke(); }
  return "REQUESTED";
}
