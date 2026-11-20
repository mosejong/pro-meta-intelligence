// CLI (OPTIONAL full-evidence path): node ops/current-draft-season-evaluation.mjs PREPARED_DATASET_JSON SEASON_EVIDENCE_JSON OUTPUT_JSON
// Same cohort, same unchanged production solo rules and fixed 3 candidates as ops/current-draft-evaluation.mjs (which is
// unchanged), plus season history from ops/prepare_current_draft_season_evidence.py (2374 capture only, as of its cutoff).
// The cohort was already observed with the baseline, so any comparison is an exploratory integration diagnostic.
// No fallback: without valid season evidence it fails. Full result stays under ignored outputs/; OUTPUT.summary.json is aggregate-only.
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const lib = await import(new URL("../web/tests/current-draft-season-evaluation-lib.mjs", import.meta.url).href);
const [input, evidencePath, output, ...extra] = process.argv.slice(2);
if (!input || !evidencePath || !output || extra.length) {
  throw new Error("Usage: node ops/current-draft-season-evaluation.mjs PREPARED_DATASET_JSON SEASON_EVIDENCE_JSON OUTPUT_JSON");
}
const outputs = resolve(fileURLToPath(new URL("../outputs/", import.meta.url)));
if (!resolve(output).startsWith(outputs + sep)) throw new Error("Full results contain per-case rows; write them under outputs/");
if ([resolve(input), resolve(evidencePath)].includes(resolve(output))) throw new Error("Output must not overwrite an input");

// The dataset hash is taken over the exact bytes the preparer hashed; the same bytes are parsed.
const bytes = await readFile(resolve(input));
const datasetSha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const dataset = JSON.parse(bytes.toString("utf8"));
const evidence = JSON.parse(await readFile(resolve(evidencePath), "utf8"));
const { vite, api } = await lib.loadSeasonApi();
try {
  const result = lib.evaluateWithSeasonEvidence(dataset, datasetSha256, evidence, api);
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(resolve(output), JSON.stringify(result, null, 2) + "\n");
  const summary = { ...lib.summarizeEvaluation(result), dataset_audit: dataset.audit };
  await writeFile(resolve(output).replace(/\.json$/, "") + ".summary.json", JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify({ status: result.status, comparison_status: result.comparison_status, denominator: result.denominator }));
} finally { await vite.close(); }
