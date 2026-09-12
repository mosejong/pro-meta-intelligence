import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: node scripts/evaluate-draft.mjs DATASET_JSON OUTPUT_JSON");
const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
try {
  const { evaluateDraftBenchmark } = await vite.ssrLoadModule("/app/draft-benchmark.ts");
  const dataset = JSON.parse(await readFile(resolve(input), "utf8"));
  const result = evaluateDraftBenchmark(dataset);
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(resolve(output), JSON.stringify(result, null, 2) + "\n");
  const { case_results: cases, ...summary } = result;
  await writeFile(resolve(output).replace(/\.json$/, "") + ".summary.json", JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify({ status: result.status, matches: result.match_count, cases: cases.length, model_top3: result.model.top3_recall, baseline_top3: result.baseline.top3_recall }));
} finally { await vite.close(); }
