// Cloud save API: store a draft scenario JSON under a random recovery code and read it back.
// Pure request handling over an injected store so it can be tested without Cloudflare.
// The code is a bearer capability: anyone with it can read/update/delete that save. Only its
// SHA-256 is stored. Bodies are opaque JSON text validated by the web app's own codec on load.

export const MAX_RAW_BYTES = 4 * 1024 * 1024;
export const MAX_STORED_BYTES = 1_500_000;
export const TTL_MS = 30 * 24 * 3600 * 1000;
export const RATE_WINDOW_MS = 3600 * 1000;
export const RATE_LIMITS = Object.freeze({ write: 30, read: 300 });
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32 (no I, L, O, U)
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{5}-?[0-9A-HJKMNP-TV-Z]{5}$/;

export function newCode(random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  const bytes = random(10);
  let out = "";
  for (let i = 0; i < 10; i++) out += ALPHABET[bytes[i] & 31];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

/** Accepts lowercase and the common look-alikes (O→0, I/L→1); returns XXXXX-XXXXX or null. */
export function normalizeCode(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1").replace(/\s/g, "");
  if (!CODE_RE.test(cleaned)) return null;
  const flat = cleaned.replace("-", "");
  return `${flat.slice(0, 5)}-${flat.slice(5)}`;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = String(env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const headers = { "Vary": "Origin" };
  if (origin && allowed.includes(origin)) {
    Object.assign(headers, { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600" });
  }
  return headers;
}

function json(status, body, extra = {}) {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer", ...extra } });
}

/** Reads at most MAX_RAW_BYTES of body text; returns null when larger. */
async function readLimited(request) {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > MAX_RAW_BYTES) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RAW_BYTES) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(all);
}

/**
 * @param {Request} request
 * @param {{ ALLOWED_ORIGINS?: string, RATE_SALT?: string }} env
 * @param {{ get(hash): Promise<{body: Uint8Array, expires_at: number}|null>, put(row): Promise<void>, update(hash, row): Promise<boolean>,
 *           remove(hash): Promise<boolean>, hit(bucket, windowStart, limit): Promise<boolean> }} store
 * @param {{ now?: () => number, code?: () => string }} deps
 */
export async function handleRequest(request, env, store, deps = {}) {
  const now = (deps.now ?? Date.now)();
  const cors = corsHeaders(request, env);
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: cors["Access-Control-Allow-Origin"] ? 204 : 403, headers: cors });
  const reply = (status, body) => json(status, body, cors);
  if (url.pathname === "/v1/health" && request.method === "GET") return reply(200, { ok: true });

  const match = url.pathname.match(/^\/v1\/saves(?:\/([^/]+))?$/);
  if (!match) return reply(404, { error: "NOT_FOUND" });
  const writing = request.method !== "GET";
  const client = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const bucket = `${writing ? "w" : "r"}:${(await sha256Hex(`${env.RATE_SALT ?? ""}|${client}`)).slice(0, 32)}`;
  const windowStart = now - (now % RATE_WINDOW_MS);
  if (!(await store.hit(bucket, windowStart, writing ? RATE_LIMITS.write : RATE_LIMITS.read))) return reply(429, { error: "RATE_LIMITED" });

  const readBody = async () => {
    const text = await readLimited(request);
    if (text === null) return { error: reply(413, { error: "TOO_LARGE" }) };
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    } catch { return { error: reply(400, { error: "INVALID_JSON" }) }; }
    const body = await gzip(text);
    if (body.byteLength > MAX_STORED_BYTES) return { error: reply(413, { error: "TOO_LARGE" }) };
    return { body, raw: new TextEncoder().encode(text).byteLength };
  };

  if (!match[1]) {
    if (request.method !== "POST") return reply(405, { error: "METHOD_NOT_ALLOWED" });
    const read = await readBody();
    if (read.error) return read.error;
    const expires_at = now + TTL_MS;
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = (deps.code ?? newCode)();
      if (await store.put({ code_hash: await sha256Hex(code), body: read.body, raw_bytes: read.raw, created_at: now, updated_at: now, expires_at })) {
        return reply(201, { code, expires_at: new Date(expires_at).toISOString() });
      }
    }
    return reply(503, { error: "CODE_SPACE_BUSY" });
  }

  const code = normalizeCode(decodeURIComponent(match[1]));
  if (!code) return reply(400, { error: "INVALID_CODE" });
  const hash = await sha256Hex(code);
  if (request.method === "GET") {
    const row = await store.get(hash);
    if (!row || row.expires_at <= now) return reply(404, { error: "NOT_FOUND" });
    return new Response(await gunzip(row.body), { status: 200, headers: { ...cors, "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
  }
  if (request.method === "PUT") {
    const read = await readBody();
    if (read.error) return read.error;
    const expires_at = now + TTL_MS;
    const ok = await store.update(hash, { body: read.body, raw_bytes: read.raw, updated_at: now, expires_at, now });
    return ok ? reply(200, { code, expires_at: new Date(expires_at).toISOString() }) : reply(404, { error: "NOT_FOUND" });
  }
  if (request.method === "DELETE") return (await store.remove(hash)) ? reply(204, null) : reply(404, { error: "NOT_FOUND" });
  return reply(405, { error: "METHOD_NOT_ALLOWED" });
}
