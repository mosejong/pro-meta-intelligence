import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
// Git checkouts use CRLF on Windows and LF on the runner. Normalize only line endings.
const feedHash = bytes => hash(Buffer.from(bytes.toString("utf8").replaceAll("\r\n", "\n")));

export function validateSeasonTransfer(feedBytes, seasonBytes, manifest, validateHistory) {
  if (manifest?.artifact_type !== "season-companion-transfer" || manifest.schema_version !== 1 ||
      manifest.feed_sha256 !== feedHash(feedBytes) || manifest.season_sha256 !== hash(seasonBytes)) throw new Error("Transfer manifest/hash mismatch");
  const feed = JSON.parse(feedBytes.toString("utf8"));
  const text = seasonBytes.toString("utf8"), season = JSON.parse(text);
  const sourceKeys = ["source_id", "source_version", "content_hash", "retrieved_at"];
  if (manifest.cutoff !== season.cutoff || !manifest.source || !season.source ||
      sourceKeys.some(key => manifest.source[key] !== season.source[key])) throw new Error("Transfer provenance mismatch");
  const result = validateHistory(feed, text);
  if (!result.ok) throw new Error(`Season companion rejected: ${result.code}`);
  return { feed, season };
}

/** Validate before writing; failure never replaces the previously accepted file. */
export async function installSeasonCompanion({ inputDir, feedPath, outputPath, validateHistory }) {
  const [feedBytes, seasonBytes, manifestText] = await Promise.all([
    readFile(feedPath), readFile(path.join(inputDir, "player-season-2026.json")), readFile(path.join(inputDir, "manifest.json"), "utf8"),
  ]);
  const { season } = validateSeasonTransfer(feedBytes, seasonBytes, JSON.parse(manifestText), validateHistory);
  let previous;
  try { previous = JSON.parse(await readFile(outputPath, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (previous && (Date.parse(season.cutoff) < Date.parse(previous.cutoff) ||
      Date.parse(season.source.retrieved_at) < Date.parse(previous.source.retrieved_at))) throw new Error("Season companion regression refused");
  const temporary = `${outputPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, seasonBytes, { flag: "wx" });
    // A changing local feed must not accept a companion that only matched before the write.
    if (feedHash(await readFile(feedPath)) !== feedHash(feedBytes)) throw new Error("Feed changed during season installation");
    await rename(temporary, outputPath);
  } finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
  return { status: "INSTALLED", cutoff: season.cutoff, source_hash: season.source.content_hash, bytes: seasonBytes.length };
}
