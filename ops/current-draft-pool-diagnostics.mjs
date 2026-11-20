// CLI (G1, descriptive only): node ops/current-draft-pool-diagnostics.mjs PREPARED_DATASET_JSON OUTPUT_JSON [SEASON_EVIDENCE_JSON]
// Pool-membership diagnostics for the unchanged current solo rules on the same prepared cohort. BASELINE always
// (seasonHistory = null); SEASON only when the 2374 season evidence is given. That evidence is validated by the
// frozen season path. The frozen evaluators run unchanged and their output is checked to be byte-identical before
// and after diagnostics. Every source/time/hash gate of the evaluators applies; nothing published or live is read
// or fetched. Per-state rows (match and champion IDs) stay under ignored outputs/; OUTPUT.summary.json is
// aggregate-only. Descriptive only: no rule change and no accuracy claim may rest on these counts.
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const lib = await import(new URL("../web/tests/current-draft-pool-diagnostics-lib.mjs", import.meta.url).href);
const [input, output, evidencePath, ...extra] = process.argv.slice(2);
if (!input || !output || extra.length) {
  throw new Error("Usage: node ops/current-draft-pool-diagnostics.mjs PREPARED_DATASET_JSON OUTPUT_JSON [SEASON_EVIDENCE_JSON]");
}
const outputs = resolve(fileURLToPath(new URL("../outputs/", import.meta.url)));
if (!resolve(output).startsWith(outputs + sep)) throw new Error("Diagnostics contain per-state rows; write them under outputs/");
if (!/\.json$/.test(output)) throw new Error("Output must be a .json path");
const summaryPath = resolve(output).replace(/\.json$/, "") + ".summary.json";
const inputs = [resolve(input), ...(evidencePath ? [resolve(evidencePath)] : [])];
if (inputs.includes(resolve(output)) || inputs.includes(summaryPath)) throw new Error("Output must not overwrite an input");

// The dataset hash is over the exact bytes the preparer hashed; the same bytes are parsed.
const bytes = await readFile(resolve(input));
const datasetSha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const dataset = JSON.parse(bytes.toString("utf8"));
const seasonEvidence = evidencePath ? JSON.parse(await readFile(resolve(evidencePath), "utf8")) : null;
const { vite, api } = await lib.loadDiagnosticsApi();
try {
  const result = lib.runPoolDiagnostics(dataset, api, { datasetSha256, seasonEvidence });
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(resolve(output), JSON.stringify(result, null, 2) + "\n");
  const summary = lib.summarizeDiagnostics(result);
  await writeFile(summaryPath, JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify({
    diagnostics_version: result.diagnostics_version,
    modes: Object.fromEntries(Object.entries(summary.modes).map(([mode, m]) => [mode, m && { states: m.states, byte_identity: m.byte_identity }])),
  }));
} finally { await vite.close(); }
