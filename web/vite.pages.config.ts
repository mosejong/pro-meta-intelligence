import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { preparePublishedAssets } from "./prepare-public";

const staticRoot = fileURLToPath(new URL("./static-site", import.meta.url));

export default defineConfig({
  root: "static-site",
  base: "/pro-meta-intelligence/",
  publicDir: preparePublishedAssets(),
  plugins: [react()],
  build: {
    outDir: "../dist-pages",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        onboarding: resolve(staticRoot, "index.html"),
        team: resolve(staticRoot, "team/index.html"),
        t1: resolve(staticRoot, "t1/index.html"),
        creator: resolve(staticRoot, "creator/index.html"),
        radar: resolve(staticRoot, "radar/index.html"),
      },
    },
  },
});
