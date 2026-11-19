import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createDraftRoomServer } from "./draft-room-http";
import { createFileRoomPersistence } from "./draft-room-persistence";

const port = Number(process.env.DRAFT_ROOM_PORT ?? "4271");
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Invalid room port");
const feedPath = resolve(process.env.DRAFT_ROOM_FEED ?? "public/feed/current.json");
const report = JSON.parse(readFileSync(feedPath, "utf8"));
const allowedOrigins = (process.env.DRAFT_ROOM_ALLOWED_ORIGINS ?? "http://127.0.0.1:4190,http://localhost:4190,http://localhost:5173,http://127.0.0.1:5173").split(",").map(value => value.trim()).filter(Boolean);
// Opt-in only. The state file holds live room credentials: keep it server-only (never public/dist/static).
const stateFile = process.env.DRAFT_ROOM_STATE_FILE;
const persistence = stateFile === undefined ? undefined
  : createFileRoomPersistence(stateFile, { forbiddenRoots: [...["public", "dist", "dist-pages", "dist-room-pages", ".next"].map(folder => resolve(folder)), dirname(feedPath)] });
const app = createDraftRoomServer({ report, allowedOrigins, persistence });
// The state path and credentials are intentionally never logged.
app.server.listen(port, "127.0.0.1", () => { console.log(`Draft room prototype listening on 127.0.0.1:${port} (${app.store.storage})`); });
const close = () => { app.closeStreams(); app.server.close(); };
process.once("SIGINT", close); process.once("SIGTERM", close);
