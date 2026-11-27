import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import { DraftRoomStore, RoomError } from "./draft-room-store";
import type { DraftRoomPersistence } from "./draft-room-persistence";
import type { RadarReport } from "../app/radar-types";

type Options = {
  report: RadarReport; allowedOrigins: string[]; clock?: () => number; ttlMs?: number;
  maxRooms?: number; maxListeners?: number; maxCreatesPerHour?: number;
  /** Explicit opt-in single-process file backend; omitted means ephemeral memory only. */
  persistence?: DraftRoomPersistence;
  /**
   * Exact addresses of reverse proxies the operator runs in front of this server. Only requests whose socket
   * comes from one of them have X-Forwarded-For read; everyone else is keyed by the socket address.
   */
  trustedProxies?: string[];
};
const normalizeAddress = (value: string) => value.startsWith("::ffff:") && isIP(value.slice(7)) === 4 ? value.slice(7) : value;
/**
 * The address used for the create limit. Without trusted proxies (or from any other peer) it is the socket
 * address, so a forged X-Forwarded-For changes nothing. From a trusted proxy it is the right-most forwarded
 * hop that is not itself a trusted proxy; a malformed hop falls back to the socket address (shared bucket).
 */
export function clientAddress(request: Pick<IncomingMessage, "socket" | "headers">, trusted: ReadonlySet<string>): string {
  const socket = normalizeAddress(request.socket.remoteAddress ?? "unknown");
  if (!trusted.has(socket)) return socket;
  const header = request.headers["x-forwarded-for"];
  const hops = (Array.isArray(header) ? header.join(",") : header ?? "").split(",").map(value => normalizeAddress(value.trim())).filter(Boolean);
  for (let index = hops.length - 1; index >= 0; index--) {
    if (!isIP(hops[index])) return socket;
    if (!trusted.has(hops[index])) return hops[index];
  }
  return socket;
}
const json = (response: ServerResponse, status: number, data: unknown) => {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
  response.end(JSON.stringify(data));
};
async function body(request: IncomingMessage) {
  if (!request.headers["content-type"]?.startsWith("application/json")) throw new RoomError(415, "CONTENT_TYPE", "요청 형식이 올바르지 않습니다.");
  let length = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk); length += buffer.length;
    if (length > 16_384) throw new RoomError(413, "BODY_LIMIT", "요청이 너무 큽니다.");
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new RoomError(400, "INVALID_JSON", "요청을 읽을 수 없습니다."); }
}
const token = (request: IncomingMessage) => {
  const value = request.headers.authorization;
  return value?.startsWith("Bearer ") ? value.slice(7) : null;
};

/** Standalone prototype (ephemeral unless `persistence` is given). Bind to loopback unless a deployment is separately reviewed. */
export function createDraftRoomServer(options: Options) {
  const origins = new Set(options.allowedOrigins);
  if (origins.has("*") || [...origins].some(origin => {
    try { return new URL(origin).origin !== origin; } catch { return true; }
  })) throw new Error("Explicit origins are required");
  const trusted = new Set((options.trustedProxies ?? []).map(value => normalizeAddress(value.trim())));
  if ([...trusted].some(value => !isIP(value))) throw new Error("Trusted proxies must be exact IP addresses");
  const store = new DraftRoomStore(options.report, options);
  const creates = new Map<string, { at: number; count: number }>();
  const streams = new Set<ServerResponse>();
  const server = createServer(async (request, response) => {
    try {
      const origin = request.headers.origin;
      if (origin && !origins.has(origin)) throw new RoomError(403, "ORIGIN_DENIED", "이 주소에서는 방에 연결할 수 없습니다.");
      if (origin) {
        response.setHeader("Access-Control-Allow-Origin", origin);
        response.setHeader("Vary", "Origin");
      }
      if (request.method === "OPTIONS") {
        response.writeHead(204, { "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Max-Age": "300" });
        response.end(); return;
      }
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.search) throw new RoomError(400, "QUERY_NOT_ALLOWED", "참여 정보는 링크나 요청 주소에 넣을 수 없습니다.");
      if (url.pathname === "/health" && request.method === "GET") {
        json(response, 200, { status: "ok", protocol: 1, storage: store.storage }); return;
      }
      if (url.pathname === "/v1/rooms" && request.method === "POST") {
        const now = options.clock?.() ?? Date.now(), key = clientAddress(request, trusted);
        for (const [ip, record] of creates) if (now - record.at >= 3_600_000) creates.delete(ip);
        const record = creates.get(key) ?? { at: now, count: 0 };
        if (record.count >= (options.maxCreatesPerHour ?? 10) || (!creates.has(key) && creates.size >= 1000)) throw new RoomError(429, "CREATE_RATE_LIMIT", "방을 너무 자주 만들었습니다. 잠시 후 다시 시도해 주세요.");
        record.count++; creates.set(key, record);
        json(response, 201, store.create(await body(request))); return;
      }
      const route = url.pathname.match(/^\/v1\/rooms\/([A-Za-z0-9_-]{22})(?:\/(join|actions|events))?$/);
      if (!route) throw new RoomError(404, "NOT_FOUND", "방 주소를 확인해 주세요.");
      const [, id, action] = route;
      if (action === "join" && request.method === "POST") { json(response, 200, store.join(id, await body(request))); return; }
      if (action === "actions" && request.method === "POST") { json(response, 200, store.act(id, token(request), await body(request))); return; }
      if (!action && request.method === "GET") { json(response, 200, store.read(id, token(request))); return; }
      if (action === "events" && request.method === "GET") {
        store.read(id, token(request));
        const resources: { release?: () => void; heartbeat?: ReturnType<typeof setInterval> } = {};
        const cleanup = () => { if (resources.heartbeat) clearInterval(resources.heartbeat); resources.release?.(); streams.delete(response); };
        response.on("close", cleanup);
        // Subscribe first so capacity/auth errors remain ordinary JSON errors.
        const pending: unknown[] = [];
        let started = false;
        resources.release = store.subscribe(id, token(request), snapshot => {
          const value = snapshot ? { snapshot } : { error: { code: "ROOM_EXPIRED", message: "방의 이용 시간이 끝났습니다." } };
          if (!started) pending.push(value);
          else if (response.writableLength > 262_144) response.end();
          else { response.write(JSON.stringify(value) + "\n"); if (!snapshot) response.end(); }
        });
        response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Accel-Buffering": "no" });
        started = true; streams.add(response);
        for (const value of pending) response.write(JSON.stringify(value) + "\n");
        resources.heartbeat = setInterval(() => { store.sweep(); if (!response.writableEnded) response.write("\n"); }, 15_000);
        resources.heartbeat.unref();
        if (response.destroyed || response.writableEnded) cleanup();
        return;
      }
      throw new RoomError(405, "METHOD_NOT_ALLOWED", "지원하지 않는 방 요청입니다.");
    } catch (error) {
      if (response.headersSent) { response.end(); return; }
      if (error instanceof RoomError) json(response, error.status, { error: { code: error.code, message: error.message } });
      else json(response, 500, { error: { code: "SERVER_ERROR", message: "방 연결에 문제가 생겼습니다. 다시 시도해 주세요." } });
    }
  });
  server.requestTimeout = 10_000; server.headersTimeout = 10_000;
  return { server, store, closeStreams: () => { for (const stream of streams) stream.end(); } };
}
