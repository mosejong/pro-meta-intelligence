import { createHash, randomBytes } from "node:crypto";
import { closeSync, chmodSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeSync, type Stats } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { championAssetId } from "../app/champion-assets";
import { SHARE_CHAMPIONS } from "../app/share-champion-ids";
import { applyDraftSelection, completeFearlessGame, DRAFT_MODEL_VERSION, fearlessLocks, type DraftGame, type DraftSelection } from "../app/draft-agent";
import type { RadarReport } from "../app/radar-types";
import type { RoomSnapshot } from "./draft-room-store";

/**
 * Opt-in, single-process, single-writer local file backend for DraftRoomStore.
 * The file holds live seat credentials (host/guest/invite/view). It is server-only sensitive data:
 * it is NOT encrypted, is written with POSIX mode 0600 (no equivalent ACL hardening on Windows),
 * and must never live under a public/static/deploy directory.
 */
export const STATE_SCHEMA = "draft-room-state";
export const STATE_VERSION = 1;
export const MAX_STATE_BYTES = 8 * 1024 * 1024;
export const MAX_PERSISTED_ROOMS = 1000;
export const MAX_PERSISTED_ACTIONS = 256;

export class PersistenceError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = "PersistenceError"; }
}
export interface DraftRoomPersistence {
  readonly mode: "file";
  /** Returns null only when no state file exists yet. Any other problem throws (fail closed). */
  load(): string | null;
  /** Atomically replaces the state or throws; a throw must leave the previous file intact. */
  save(text: string): void;
}
export type PersistedRoom = {
  snapshot: RoomSnapshot; host: string; guest: string | null; invite: string; view: string;
  actions: [string, string][];
};
export type FeedIdentity = { sha256: string; patch_id: string; cutoff: string; model_version: string };

export function feedIdentity(report: RadarReport): FeedIdentity {
  return { sha256: createHash("sha256").update(JSON.stringify(report)).digest("hex"), patch_id: report.patch_id, cutoff: report.cutoff, model_version: DRAFT_MODEL_VERSION };
}
export const actionFingerprint = (kind: unknown, championId: unknown) =>
  createHash("sha256").update(JSON.stringify([kind, championId ?? null])).digest("base64url");

// A function declaration (not an arrow const) so `if (bad) fail(...)` narrows types for the compiler.
function fail(code: string): never {
  throw new PersistenceError(code, `Draft room state rejected (${code}); the file was left unchanged.`);
}
const isActionEntry = (value: unknown): value is [string, string] =>
  Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "string" &&
  ACTION_KEY.test(value[0]) && FINGERPRINT.test(value[1]);
const TOKEN = /^[A-Za-z0-9_-]{32}$/, ROOM_ID = /^[A-Za-z0-9_-]{22}$/, ACTION_KEY = /^(BLUE|RED):[A-Za-z0-9_-]{12,80}$/, FINGERPRINT = /^[A-Za-z0-9_-]{43}$/;
const canonical = new Map(SHARE_CHAMPIONS.flatMap(([name, id]) => [[championAssetId(name).toLowerCase(), id], [id.toLowerCase(), id]] as [string, string][]));
const record = (value: unknown, keys: string[], code: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  const own = Object.keys(value as object);
  if (own.length !== keys.length || !keys.every(key => own.includes(key))) fail(code);
  return value as Record<string, unknown>;
};
const isoTime = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const SELECTION_KEYS = ["side", "kind", "slot", "phase", "turn", "champion_id"];
function storedSelections(value: unknown, max: number): DraftSelection[] {
  if (!Array.isArray(value) || value.length > max) fail("ILLEGAL_DRAFT");
  return (value as unknown[]).map(item => {
    const selection = record(item, SELECTION_KEYS, "ILLEGAL_DRAFT");
    const id = selection.champion_id;
    if (typeof id !== "string" || id.length > 80 || canonical.get(championAssetId(id).toLowerCase()) !== id) fail("ILLEGAL_DRAFT");
    return selection as unknown as DraftSelection;
  });
}

/** Re-derives the draft with the same validators the live store uses; any divergence is illegal. */
function validateDraft(snapshot: Record<string, unknown>, report: RadarReport) {
  const teams = report.opponent_prep?.teams ?? [];
  const blue = snapshot.blueTeamId, red = snapshot.redTeamId, first = snapshot.firstPickSide;
  if (typeof blue !== "string" || typeof red !== "string" || blue === red || !teams.some(t => t.team_id === blue) || !teams.some(t => t.team_id === red)) fail("ILLEGAL_DRAFT");
  if (first !== "BLUE" && first !== "RED") fail("ILLEGAL_DRAFT");
  if (!Array.isArray(snapshot.games) || snapshot.games.length > 9) fail("ILLEGAL_DRAFT");
  let games: DraftGame[] = [];
  for (const raw of snapshot.games as unknown[]) {
    const game = record(raw, ["blue_team_id", "red_team_id", "selections"], "ILLEGAL_DRAFT");
    if (game.blue_team_id !== blue || game.red_team_id !== red) fail("ILLEGAL_DRAFT");
    const stored = { blue_team_id: blue as string, red_team_id: red as string, selections: storedSelections(game.selections, 20) };
    const next = completeFearlessGame(games, stored);
    if (next === games || !isDeepStrictEqual(next.at(-1), stored)) fail("ILLEGAL_DRAFT");
    games = next;
  }
  const stored = storedSelections(snapshot.selections, 20), locks = fearlessLocks(games);
  let replay: DraftSelection[] = [];
  for (const selection of stored) {
    const next = applyDraftSelection(replay, selection.champion_id, locks, first as "BLUE" | "RED");
    if (next === replay) fail("ILLEGAL_DRAFT");
    replay = next;
  }
  if (!isDeepStrictEqual(replay, stored)) fail("ILLEGAL_DRAFT");
}

export function encodeState(identity: FeedIdentity, rooms: PersistedRoom[], now: number) {
  if (rooms.length > MAX_PERSISTED_ROOMS) fail("STATE_TOO_LARGE");
  const text = JSON.stringify({ schema: STATE_SCHEMA, version: STATE_VERSION, feed: identity, saved_at: new Date(now).toISOString(), rooms });
  if (Buffer.byteLength(text, "utf8") > MAX_STATE_BYTES) fail("STATE_TOO_LARGE");
  return text;
}

/** Validates the whole file before anything is restored. Expired rooms are dropped, never extended. */
export function decodeState(text: string, context: { report: RadarReport; identity: FeedIdentity; now: number; ttlMs: number; maxRooms: number }): PersistedRoom[] {
  if (Buffer.byteLength(text, "utf8") > MAX_STATE_BYTES) fail("STATE_TOO_LARGE");
  let data: unknown;
  try { data = JSON.parse(text); } catch { fail("STATE_CORRUPT"); }
  const top = record(data, ["schema", "version", "feed", "saved_at", "rooms"], "STATE_CORRUPT");
  if (top.schema !== STATE_SCHEMA || top.version !== STATE_VERSION) fail("STATE_SCHEMA");
  if (!isDeepStrictEqual(record(top.feed, ["sha256", "patch_id", "cutoff", "model_version"], "STATE_CORRUPT"), context.identity)) fail("FEED_MISMATCH");
  if (!isoTime(top.saved_at)) fail("STATE_CORRUPT");
  if (!Array.isArray(top.rooms) || top.rooms.length > Math.min(MAX_PERSISTED_ROOMS, context.maxRooms)) fail("ROOM_LIMIT");
  const ids = new Set<string>(), secrets = new Set<string>(), result: PersistedRoom[] = [];
  for (const raw of top.rooms as unknown[]) {
    const room = record(raw, ["snapshot", "host", "guest", "invite", "view", "actions"], "STATE_CORRUPT");
    const snapshot = record(room.snapshot, ["id", "revision", "patch_id", "cutoff", "model_version", "blueTeamId", "redTeamId", "firstPickSide", "selections", "games", "seats", "status", "expiresAt"], "STATE_CORRUPT");
    if (typeof snapshot.id !== "string" || !ROOM_ID.test(snapshot.id) || ids.has(snapshot.id)) fail("STATE_CORRUPT");
    ids.add(snapshot.id as string);
    if (snapshot.patch_id !== context.report.patch_id || snapshot.cutoff !== context.report.cutoff || snapshot.model_version !== DRAFT_MODEL_VERSION) fail("FEED_MISMATCH");
    if (!Number.isSafeInteger(snapshot.revision) || (snapshot.revision as number) < 0) fail("STATE_CORRUPT");
    const tokens = [room.host, room.invite, room.view, ...(room.guest === null ? [] : [room.guest])];
    for (const token of tokens) {
      if (typeof token !== "string" || !TOKEN.test(token) || secrets.has(token)) fail("CREDENTIAL_INVALID");
      secrets.add(token as string);
    }
    const seats = record(snapshot.seats, ["BLUE", "RED"], "STATE_CORRUPT");
    if (seats.BLUE !== true || seats.RED !== (room.guest !== null)) fail("CREDENTIAL_INVALID");
    validateDraft(snapshot, context.report);
    const status = !seats.RED ? "WAITING" : (snapshot.selections as unknown[]).length === 20 ? "COMPLETE" : "DRAFTING";
    if (snapshot.status !== status) fail("ILLEGAL_DRAFT");
    if (!isoTime(snapshot.expiresAt)) fail("STATE_CORRUPT");
    const expiresAt = Date.parse(snapshot.expiresAt as string);
    if (expiresAt > context.now + context.ttlMs) fail("EXPIRY_INVALID");
    if (!Array.isArray(room.actions) || room.actions.length > MAX_PERSISTED_ACTIONS) fail("STATE_CORRUPT");
    const keys = new Set<string>();
    for (const action of room.actions as unknown[]) {
      if (!isActionEntry(action)) fail("STATE_CORRUPT");
      const [key] = action;
      if (keys.has(key) || (key.startsWith("RED:") && room.guest === null)) fail("STATE_CORRUPT");
      keys.add(key);
    }
    if (expiresAt <= context.now) continue;
    result.push(structuredClone(room) as unknown as PersistedRoom);
  }
  return result;
}

/** Directory names that are (or are built into) statically served output in this project or common hosts. */
const PUBLIC_SEGMENT = /^(public|static|www|htdocs|_site|build|out|dist(-.*)?|\.next|\.output|\.vercel|\.netlify)$/i;
const fold = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
const inside = (root: string, path: string) => {
  const rel = relative(fold(root), fold(path));
  // Only an exact ".." segment escapes the root; a child named "..cache" is still inside it.
  const escapes = rel === ".." || rel.startsWith(".." + sep);
  return rel === "" || (!escapes && !isAbsolute(rel));
};
/** Resolves symlinks/junctions of the nearest existing ancestor so aliases cannot hide a public target. */
function realTarget(path: string) {
  const rest: string[] = [];
  let current = path;
  for (;;) {
    try { return join(realpathSync.native(current), ...rest.reverse()); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") fail("INVALID_PATH");
      const parent = dirname(current);
      if (parent === current) fail("INVALID_PATH");
      rest.push(basename(current)); current = parent;
    }
  }
}
function assertServerOnly(path: string, forbiddenRoots: string[]) {
  for (const candidate of new Set([path, realTarget(path)])) {
    if (candidate.split(/[\\/]+/).slice(0, -1).some(part => PUBLIC_SEGMENT.test(part))) fail("PUBLIC_PATH");
    for (const root of forbiddenRoots) {
      if (inside(root, candidate) || inside(realTarget(root), candidate)) fail("PUBLIC_PATH");
    }
  }
}
/**
 * Rejects paths that could be served statically, including via a symlink/junction parent. The check is
 * repeated before every load/save because a link can be swapped after startup. Single writer only.
 * `forbiddenRoots` adds deployment roots explicitly.
 */
export function createFileRoomPersistence(filePath: string, options: { forbiddenRoots?: string[]; maxBytes?: number } = {}): DraftRoomPersistence {
  if (typeof filePath !== "string" || !filePath.trim()) fail("INVALID_PATH");
  const path = resolve(filePath), maxBytes = Math.min(options.maxBytes ?? MAX_STATE_BYTES, MAX_STATE_BYTES);
  const roots = (options.forbiddenRoots ?? []).map(root => resolve(root));
  assertServerOnly(path, roots);
  return {
    mode: "file",
    load() {
      assertServerOnly(path, roots);
      let stat: Stats;
      try { stat = lstatSync(path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; fail("STATE_UNREADABLE"); }
      if (!stat.isFile()) fail("STATE_UNREADABLE");
      if (stat.size > maxBytes) fail("STATE_TOO_LARGE");
      let bytes: Buffer;
      try { bytes = readFileSync(path); } catch { fail("STATE_UNREADABLE"); }
      if (bytes.length > maxBytes) fail("STATE_TOO_LARGE");
      try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fail("STATE_CORRUPT"); }
    },
    save(text) {
      assertServerOnly(path, roots);
      const bytes = Buffer.from(text, "utf8");
      if (bytes.length > maxBytes) fail("STATE_TOO_LARGE");
      const temp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
      let fd: number | undefined;
      try {
        fd = openSync(temp, "wx", 0o600);
        for (let offset = 0; offset < bytes.length;) offset += writeSync(fd, bytes, offset, bytes.length - offset);
        fsyncSync(fd); closeSync(fd); fd = undefined;
        renameSync(temp, path);
      } catch {
        if (fd !== undefined) { try { closeSync(fd); } catch { /* already closed */ } }
        try { unlinkSync(temp); } catch { /* not created */ }
        fail("STATE_WRITE_FAILED");
      }
      try { chmodSync(path, 0o600); } catch { /* best effort; Windows ignores POSIX modes */ }
    },
  };
}
