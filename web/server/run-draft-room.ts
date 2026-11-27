import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createDraftRoomServer } from "./draft-room-http";
import { createFileRoomPersistence } from "./draft-room-persistence";
import { feedReloadSeconds, reloadFeed } from "./draft-room-feed";

const port = Number(process.env.DRAFT_ROOM_PORT ?? "4271");
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Invalid room port");
// Loopback by default; a different bind address is an explicit deployment decision.
const host = process.env.DRAFT_ROOM_HOST?.trim() || "127.0.0.1";
const feedPath = resolve(process.env.DRAFT_ROOM_FEED ?? "public/feed/current.json");
const report = JSON.parse(readFileSync(feedPath, "utf8"));
const allowedOrigins = (process.env.DRAFT_ROOM_ALLOWED_ORIGINS ?? "http://127.0.0.1:4190,http://localhost:4190,http://localhost:5173,http://127.0.0.1:5173").split(",").map(value => value.trim()).filter(Boolean);
// Exact proxy addresses only; empty means the socket address is always used for the create limit.
const trustedProxies = (process.env.DRAFT_ROOM_TRUSTED_PROXIES ?? "").split(",").map(value => value.trim()).filter(Boolean);
const reloadSeconds = feedReloadSeconds(process.env.DRAFT_ROOM_FEED_RELOAD_SECONDS);
// Opt-in only. The state file holds live room credentials: keep it server-only (never public/dist/static).
const stateFile = process.env.DRAFT_ROOM_STATE_FILE;
if (stateFile !== undefined && reloadSeconds !== null) throw new Error("DRAFT_ROOM_STATE_FILE and DRAFT_ROOM_FEED_RELOAD_SECONDS cannot be combined yet: the state file is tied to one feed");
const persistence = stateFile === undefined ? undefined
  : createFileRoomPersistence(stateFile, { forbiddenRoots: [...["public", "static-site", ".site-public", "dist", "dist-pages", "dist-room-pages", ".next"].map(folder => resolve(folder)), dirname(feedPath)] });
const app = createDraftRoomServer({ report, allowedOrigins, persistence, trustedProxies });
// The state path, feed path and credentials are intentionally never logged.
app.server.listen(port, host, () => { console.log(`Draft room prototype listening on ${host}:${port} (${app.store.storage})`); });
const reload = reloadSeconds === null ? undefined : setInterval(() => {
  const before = app.store.feed;
  const result = reloadFeed(app.store, () => readFileSync(feedPath, "utf8"));
  if (result === "UPDATED") console.log(`Feed for new rooms: ${before.patch_id} ${before.cutoff} -> ${app.store.feed.patch_id} ${app.store.feed.cutoff}`);
  else if (result !== "UNCHANGED") console.warn(`Feed reload kept the last valid report (${result})`);
}, reloadSeconds * 1000);
reload?.unref();
const close = () => { if (reload) clearInterval(reload); app.closeStreams(); app.server.close(); };
process.once("SIGINT", close); process.once("SIGTERM", close);
