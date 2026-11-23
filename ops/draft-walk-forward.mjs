// CLI: node ops/draft-walk-forward.mjs DATASET_JSON OUTPUT_JSON [--unseal-holdout]
// Protocol: docs/benchmarks/DRAFT_RULE_WALK_FORWARD_PROTOCOL_2026-11-23.md
// Replays walk_forward_dataset.py output through the unchanged production solo rules and two fixed
// baselines. The output is aggregate-only (no team IDs, no per-state rows) and must stay under outputs/
// until it is reviewed. The HOLDOUT split is replayed only with --unseal-holdout.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const lib = await import(new URL("../web/tests/draft-walk-forward-lib.mjs", import.meta.url).href);
const args = process.argv.slice(2);
const unsealHoldout = args.includes("--unseal-holdout");
const [input, output, ...extra] = args.filter((arg) => arg !== "--unseal-holdout");
if (!input || !output || extra.length) throw new Error("Usage: node ops/draft-walk-forward.mjs DATASET_JSON OUTPUT_JSON [--unseal-holdout]");
const outputs = resolve(fileURLToPath(new URL("../outputs/", import.meta.url)));
if (!resolve(output).startsWith(outputs + sep)) throw new Error("Write evaluation results under outputs/");

const dataset = JSON.parse(await readFile(resolve(input), "utf8"));
const { vite, api } = await lib.loadProductionApi();
try {
  const result = lib.evaluateWalkForward(dataset, api, { unsealHoldout });
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(resolve(output), JSON.stringify(result, null, 2) + "\n");
  const brief = Object.fromEntries(Object.entries(result.splits).map(([name, split]) => [name, {
    status: split.status, matches: split.matches, sealed_matches: split.sealed_matches,
    top3: split.overall && Object.fromEntries(Object.entries(split.overall).map(([m, v]) => [m, v.top3_rate])),
    production_minus_baseline_top3_ci95: split.bootstrap?.production_minus_baseline_top3_ci95 ?? null,
  }]));
  console.log(JSON.stringify({ holdout_unsealed: result.holdout_unsealed, splits: brief }));
} finally { await vite.close(); }
