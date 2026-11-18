import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, readdir, unlink, rmdir } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { installSeasonCompanion, validateSeasonTransfer } from "../scripts/season-companion-transfer.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
async function scenario(run) {
  const dir = await mkdtemp(path.join(tmpdir(), "pmi-season-"));
  const feedPath = path.join(dir, "feed.json"), outputPath = path.join(dir, "accepted.json");
  const feed = Buffer.from(JSON.stringify({ cutoff: "2026-11-18T00:00:00Z" }));
  const season = { cutoff: "2026-11-18T00:00:00Z", source: { source_id: "oe", source_version: "v", content_hash: "h", retrieved_at: "2026-11-17T00:00:00Z" } };
  const body = Buffer.from(JSON.stringify(season));
  const manifest = { artifact_type: "season-companion-transfer", schema_version: 1, feed_sha256: hash(feed), season_sha256: hash(body), cutoff: season.cutoff, source: season.source };
  await writeFile(feedPath, feed); await writeFile(path.join(dir, "player-season-2026.json"), body);
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest));
  await writeFile(outputPath, JSON.stringify({ cutoff: "2026-11-14T00:00:00Z", source: { retrieved_at: "2026-11-13T00:00:00Z" } }));
  const original = await readFile(outputPath, "utf8");
  try { await run({ dir, feedPath, outputPath, feed, body, manifest, original, options: { inputDir: dir, feedPath, outputPath, validateHistory: () => ({ ok: true }) } }); }
  finally { for (const file of await readdir(dir)) await unlink(path.join(dir, file)); await rmdir(dir); }
}

test("matching hashes and validated basis install exact bytes with no temporary residue", async () => scenario(async s => {
  const result = await installSeasonCompanion(s.options); assert.equal(result.status, "INSTALLED");
  assert.deepEqual(await readFile(s.outputPath), s.body);
  assert.ok(!(await readdir(s.dir)).some(name => name.endsWith(".tmp")));
}));
test("Windows CRLF feed checkouts match runner LF, but changed JSON values do not", async () => scenario(async s => {
  const lf = Buffer.from(JSON.stringify(JSON.parse(s.feed), null, 2) + "\n");
  const manifest = { ...s.manifest, feed_sha256: hash(lf) };
  assert.doesNotThrow(() => validateSeasonTransfer(Buffer.from(lf.toString().replaceAll("\n", "\r\n")), s.body, manifest, () => ({ ok: true })));
  assert.throws(() => validateSeasonTransfer(Buffer.from(lf.toString().replace("2026-11-18", "2026-11-19")), s.body, manifest, () => ({ ok: true })), /hash mismatch/);
}));
test("tampered bytes, source manifest and parser rejection preserve accepted file", async () => scenario(async s => {
  assert.throws(() => validateSeasonTransfer(s.feed, Buffer.from("{}"), s.manifest, () => ({ ok: true })), /hash mismatch/);
  assert.throws(() => validateSeasonTransfer(s.feed, s.body, { ...s.manifest, source: { ...s.manifest.source, source_version: "other" } }, () => ({ ok: true })), /provenance/);
  await assert.rejects(installSeasonCompanion({ ...s.options, validateHistory: () => ({ ok: false, code: "BASIS_MISMATCH" }) }), /BASIS_MISMATCH/);
  assert.equal(await readFile(s.outputPath, "utf8"), s.original);
}));
test("changed feed during validation and regressing companion never replace the accepted file", async () => scenario(async s => {
  await assert.rejects(installSeasonCompanion({ ...s.options, validateHistory: () => { writeFileSync(s.feedPath, "{}"); return { ok: true }; } }), /Feed changed/);
  assert.equal(await readFile(s.outputPath, "utf8"), s.original);
  await writeFile(s.feedPath, s.feed);
  const newer = JSON.stringify({ cutoff: "2026-11-19T00:00:00Z", source: { retrieved_at: "2026-11-18T00:00:00Z" } });
  await writeFile(s.outputPath, newer);
  await assert.rejects(installSeasonCompanion(s.options), /regression/);
  assert.equal(await readFile(s.outputPath, "utf8"), newer);
  assert.ok(!(await readdir(s.dir)).some(name => name.endsWith(".tmp")));
}));
