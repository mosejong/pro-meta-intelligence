import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDraftRoomServer } from "./draft-room-http";

const port = Number(process.env.DRAFT_ROOM_PORT ?? "4271");
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Invalid room port");
const report = JSON.parse(readFileSync(resolve(process.env.DRAFT_ROOM_FEED ?? "public/feed/current.json"), "utf8"));
const allowedOrigins = (process.env.DRAFT_ROOM_ALLOWED_ORIGINS ?? "http://127.0.0.1:4190,http://localhost:4190,http://localhost:5173,http://127.0.0.1:5173").split(",").map(value => value.trim()).filter(Boolean);
const app = createDraftRoomServer({ report, allowedOrigins });
app.server.listen(port, "127.0.0.1", () => { console.log(`Draft room prototype listening on 127.0.0.1:${port} (ephemeral)`); });
const close = () => { app.closeStreams(); app.server.close(); };
process.once("SIGINT", close); process.once("SIGTERM", close);
