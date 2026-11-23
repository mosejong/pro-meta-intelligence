/**
 * Client for the cloud save worker (cloud/src/handler.mjs): store the same draft scenario JSON the
 * file save produces under a recovery code, and fetch it back on another device. The text loaded
 * back is validated by the existing parseDraftSession codec before anything is restored.
 * Disabled (no UI) unless a VITE_CLOUD_SAVE_URL build variable points at a deployed worker.
 */

export const CLOUD_SAVE_TIMEOUT_MS = 15_000;
export const CLOUD_SAVE_MAX_BYTES = 4 * 1024 * 1024;
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/;

export type CloudSaveError = "NOT_CONFIGURED" | "TOO_LARGE" | "INVALID_CODE" | "NOT_FOUND" | "RATE_LIMITED" | "NETWORK" | "SERVER";
export type CloudUploadResult = { ok: true; code: string; expiresAt: string } | { ok: false; error: CloudSaveError };
export type CloudDownloadResult = { ok: true; text: string } | { ok: false; error: CloudSaveError };
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Only https endpoints (or a loopback http one for local testing) are accepted. */
export function cloudSaveEndpoint(raw: unknown = (import.meta as { env?: Record<string, unknown> }).env?.VITE_CLOUD_SAVE_URL): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim());
    const loopback = url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
    if (url.protocol !== "https:" && !loopback) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.origin + url.pathname.replace(/\/+$/, "");
  } catch { return null; }
}

/** Same normalization as the worker: lowercase and look-alikes (O→0, I/L→1) accepted. */
export function normalizeCloudCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const flat = value.trim().toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1").replace(/[\s-]/g, "");
  if (flat.length !== 10) return null;
  const code = `${flat.slice(0, 5)}-${flat.slice(5)}`;
  return CODE_RE.test(code) ? code : null;
}

const errorOf = (status: number): CloudSaveError => status === 404 ? "NOT_FOUND" : status === 413 ? "TOO_LARGE" : status === 429 ? "RATE_LIMITED" : "SERVER";

async function call(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<Response | null> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), CLOUD_SAVE_TIMEOUT_MS) : null;
  try { return await fetchImpl(url, { ...init, signal: controller?.signal, credentials: "omit", cache: "no-store" }); }
  catch { return null; }
  finally { if (timer) clearTimeout(timer); }
}

export async function uploadCloudSave(text: string, endpoint: string | null = cloudSaveEndpoint(), fetchImpl: FetchLike = fetch): Promise<CloudUploadResult> {
  if (!endpoint) return { ok: false, error: "NOT_CONFIGURED" };
  if (new TextEncoder().encode(text).byteLength > CLOUD_SAVE_MAX_BYTES) return { ok: false, error: "TOO_LARGE" };
  const response = await call(fetchImpl, `${endpoint}/v1/saves`, { method: "POST", headers: { "Content-Type": "application/json" }, body: text });
  if (!response) return { ok: false, error: "NETWORK" };
  if (response.status !== 201) return { ok: false, error: errorOf(response.status) };
  try {
    const body = await response.json() as { code?: unknown; expires_at?: unknown };
    const code = normalizeCloudCode(body.code);
    if (!code || typeof body.expires_at !== "string" || !Number.isFinite(Date.parse(body.expires_at))) return { ok: false, error: "SERVER" };
    return { ok: true, code, expiresAt: body.expires_at };
  } catch { return { ok: false, error: "SERVER" }; }
}

export async function downloadCloudSave(rawCode: string, endpoint: string | null = cloudSaveEndpoint(), fetchImpl: FetchLike = fetch): Promise<CloudDownloadResult> {
  if (!endpoint) return { ok: false, error: "NOT_CONFIGURED" };
  const code = normalizeCloudCode(rawCode);
  if (!code) return { ok: false, error: "INVALID_CODE" };
  const response = await call(fetchImpl, `${endpoint}/v1/saves/${code}`, { method: "GET" });
  if (!response) return { ok: false, error: "NETWORK" };
  if (response.status !== 200) return { ok: false, error: errorOf(response.status) };
  try {
    const text = await response.text();
    return new TextEncoder().encode(text).byteLength > CLOUD_SAVE_MAX_BYTES ? { ok: false, error: "TOO_LARGE" } : { ok: true, text };
  } catch { return { ok: false, error: "NETWORK" }; }
}
