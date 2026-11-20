import type { DraftSide } from "./draft-agent";
import { parseDraftSession, readLocalDraftWithReview, writeLocalDraftWithReview, type DraftSession, type LocalDraftWithReview } from "./draft-session";
import type { SoloAutoHistory } from "./solo-draft-history";
import { parseSoloReview, serializeSoloReview } from "./solo-review-retention";

/**
 * Stage-3 adapter between draft-lab autosave/startup restore and the stage-2 storage pair.
 * The board text stays the exact `serializeDraftScenario` string. The optional sidecar holds the
 * user's own local practice notes (frozen auto-choice records + manual side), bound to the board by
 * SHA-256 of its exact UTF-8 bytes. A stored note is never proof, prediction evidence or AI output;
 * any note failure only drops the note and never blocks the board.
 */
export type DraftAutosaveRequest = { readonly scenario: string; readonly manualSide: DraftSide; readonly records: SoloAutoHistory };
export type SoloReviewDigest = (text: string) => Promise<string | null>;
type PairWriter = (scenario: string, review: string | null) => Promise<void>;

const SHA_HEX = /^[0-9a-f]{64}$/;

/** WebCrypto SHA-256 of the exact UTF-8 bytes as lowercase hex; null when WebCrypto is unavailable. */
export async function webCryptoSha256(text: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== "function") return null;
  const buffer = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Never rejects: any digest failure or malformed result is "no hash" (the note is dropped, the board kept). */
async function safeDigest(digest: SoloReviewDigest, text: string): Promise<string | null> {
  try {
    const hex = await digest(text);
    return typeof hex === "string" && SHA_HEX.test(hex) ? hex : null;
  } catch { return null; }
}

/**
 * Serialized saver. Digests may run (and finish) in any order, but each request's whole
 * hash -> serialize -> write step starts only after the previous request's write settled, so storage
 * commits keep invocation order. A failed write never blocks the next request. No timers or retries here.
 */
export function createSoloReviewAutosave({ digest = webCryptoSha256, write = writeLocalDraftWithReview as PairWriter }: { digest?: SoloReviewDigest; write?: PairWriter } = {}) {
  let chain: Promise<void> = Promise.resolve();
  return function save(request: DraftAutosaveRequest): Promise<void> {
    const records = request.records;
    // Hashing starts now; only the write order is serialized.
    const hash = records.length ? safeDigest(digest, request.scenario) : Promise.resolve(null);
    const run = chain.catch(() => undefined).then(async () => {
      let review: string | null = null;
      if (records.length) {
        const sha = await hash;
        if (sha) {
          try {
            const encoded = serializeSoloReview(sha, request.manualSide, records);
            if (encoded.ok) review = encoded.text;
          } catch { review = null; }
        }
      }
      // No notes, no hash or a codec refusal: board-only write, which DELETEs any old sidecar atomically.
      return write(request.scenario, review);
    });
    chain = run;
    return run;
  };
}

/** Module-wide saver used by the persistent autosave tracker (one write order for the whole app). */
export const saveDraftAutosave = createSoloReviewAutosave();

export type RestoredSoloNotes = { manualSide: DraftSide; records: SoloAutoHistory };
export type LocalDraftRestore =
  | { kind: "EMPTY" }
  | { kind: "INVALID"; result: Extract<ReturnType<typeof parseDraftSession>, { ok: false }> }
  | { kind: "RESTORED"; session: DraftSession; notes: RestoredSoloNotes | null };

/**
 * Startup read: board + sidecar from one storage transaction, board parsed exactly as before, then
 * (only when a sidecar exists) SHA-256 of the exact raw board text and the strict codec. A missing,
 * unhashable or invalid note yields `notes: null` with the board still restored; it is never a restore
 * failure. Storage failures reject as before. Pure: the caller decides whether the result still applies.
 */
export async function readLocalDraftForRestore({ read = readLocalDraftWithReview as () => Promise<LocalDraftWithReview>, digest = webCryptoSha256 }: { read?: () => Promise<LocalDraftWithReview>; digest?: SoloReviewDigest } = {}): Promise<LocalDraftRestore> {
  const saved = await read();
  if (!saved.scenario) return { kind: "EMPTY" };
  const parsed = parseDraftSession(saved.scenario);
  if (!parsed.ok) return { kind: "INVALID", result: parsed };
  let notes: RestoredSoloNotes | null = null;
  if (saved.review !== null) {
    const sha = await safeDigest(digest, saved.scenario);
    if (sha) {
      try {
        const review = parseSoloReview(saved.review, parsed.session, sha);
        if (review.ok) notes = { manualSide: review.manualSide, records: review.records };
      } catch { notes = null; }
    }
  }
  return { kind: "RESTORED", session: parsed.session, notes };
}
