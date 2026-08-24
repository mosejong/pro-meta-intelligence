import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { preparePublishedAssets } from "./prepare-public";

export default defineConfig({
  root: "static-site",
  base: "/pro-meta-intelligence/",
  publicDir: preparePublishedAssets(),
  plugins: [react()],
  build: {
    outDir: "../dist-pages",
    emptyOutDir: true,
  },
});
