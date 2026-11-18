import { defineConfig } from "@playwright/test";
import base from "./playwright.config.mjs";

export default defineConfig({
  ...base,
  testMatch: "draft-room.spec.mjs",
  outputDir: "../outputs/realtime-room-ui-20261118",
  reporter: [["list"], ["json", { outputFile: "../outputs/realtime-room-ui-20261118/results.json" }]],
  use: { ...base.use, baseURL: "http://127.0.0.1:4192" },
  webServer: [
    { command: "node dist-room/server.mjs", url: "http://127.0.0.1:4271/health", reuseExistingServer: false,
      timeout: 30_000, env: { DRAFT_ROOM_PORT: "4271", DRAFT_ROOM_ALLOWED_ORIGINS: "http://127.0.0.1:4192" } },
    { command: "node node_modules/vite/bin/vite.js preview --config vite.pages.config.ts --outDir ../dist-room-pages --host 127.0.0.1 --port 4192 --strictPort",
      url: "http://127.0.0.1:4192/pro-meta-intelligence/", reuseExistingServer: false, timeout: 30_000 },
  ],
});
