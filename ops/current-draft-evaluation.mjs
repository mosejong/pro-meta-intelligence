// CLI: node ops/current-draft-evaluation.mjs PREPARED_DATASET_JSON OUTPUT_JSON
// Evaluates the unchanged production solo rules on a draft_dataset.py output (2374 inputs, fcd2 outcomes).
// Full result (team IDs, per-case rows) must stay under ignored outputs/; OUTPUT.summary.json is aggregate-only.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const lib = await import(new URL("../web/tests/current-draft-evaluation-lib.mjs", import.meta.url).href);
const [input, output, ...extra] = process.argv.slice(2);
if (!input || !output || extra.length) throw new Error("Usage: node ops/current-draft-evaluation.mjs PREPARED_DATASET_JSON OUTPUT_JSON");
const outputs = resolve(fileURLToPath(new URL("../outputs/", import.meta.url)));
if (!resolve(output).startsWith(outputs + sep)) throw new Error("Full results contain per-case rows; write them under outputs/");

const dataset = JSON.parse(await readFile(resolve(input), "utf8"));
const { vite, api } = await lib.loadProductionApi();
try {
  const result = lib.evaluateCurrentDraftRules(dataset, api);
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(resolve(output), JSON.stringify(result, null, 2) + "\n");
  const summary = { ...lib.summarizeEvaluation(result), dataset_audit: dataset.audit };
  await writeFile(resolve(output).replace(/\.json$/, "") + ".summary.json", JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify({ status: result.status, denominator: result.denominator }));
} finally { await vite.close(); }
