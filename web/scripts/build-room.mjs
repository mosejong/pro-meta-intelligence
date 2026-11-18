import { build } from "vite";

await build({
  configFile: false,
  publicDir: false,
  build: {
    ssr: "server/run-draft-room.ts", outDir: "dist-room", emptyOutDir: true,
    target: "node22", minify: false, rollupOptions: { output: { entryFileNames: "server.mjs" } },
  },
});
