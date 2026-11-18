import { MAX_DRAFT_FILE_BYTES, parseDraftSession, type DraftSession, type DraftSessionErrorCode } from "./draft-session";

/**
 * Named local practice library ("내 연습 보관함"). Separate database from the autosave
 * (`pro-meta-draft` v1 / sessions/current is never opened here). Each saved practice keeps the
 * exact scenario string produced by `serializeDraftScenario` (incl. v4 explicit positions) and is
 * re-validated with `parseDraftSession` on every read; no other data model is copied.
 */
export const PRACTICE_DB_NAME = "pro-meta-practice-library";
export const PRACTICE_DB_VERSION = 1;
export const PRACTICE_LIMIT = 5;
export const PRACTICE_NAME_MAX = 50;
export const PRACTICE_TIMEOUT_MS = 10_000;
export const PRACTICE_SCHEMA_VERSION = 1;
const ENTRIES = "entries";
const SCENARIOS = "scenarios";

export type PracticeEntry = {
  schema_version: typeof PRACTICE_SCHEMA_VERSION;
  id: string;
  name: string;
  created_at: string;
  /** Display-only summary derived from the parsed scenario at save time. */
  summary: { patch_id: string; game_number: number; selections: number; positions: boolean };
};
export type PracticeErrorCode =
  | "NAME_EMPTY" | "NAME_TOO_LONG" | "NAME_INVALID_CHARS" | "NAME_DUPLICATE" | "LIMIT"
  | "INVALID_SCENARIO" | "TOO_LARGE" | "QUOTA" | "BLOCKED" | "TIMEOUT" | "UNAVAILABLE"
  | "NOT_FOUND" | "CORRUPT" | "FAILED";
export class PracticeError extends Error {
  constructor(readonly code: PracticeErrorCode, readonly sessionCode?: DraftSessionErrorCode) { super(code); }
}
export type PracticeList = { entries: PracticeEntry[]; damaged: string[] };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

// C0/C1 controls, line/paragraph separators and bidi overrides/isolates (display spoofing).
const INVALID_NAME_CHARS = new RegExp(`[${String.raw`\p{Cc}`}${[[0x2028, 0x2029], [0x202a, 0x202e], [0x2066, 0x2069]].map(([a, b]) => String.fromCharCode(a) + "-" + String.fromCharCode(b)).join("")}]`, "u");
const ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
const nameKey = (name: string) => name.normalize("NFC").toLowerCase();

export type NameCheck = { ok: true; name: string } | { ok: false; code: PracticeErrorCode };
/** Trim, then reject empty, >50 code points, control/bidi characters and (optionally) duplicates. */
export function validatePracticeName(raw: unknown, existingNames: readonly string[] = []): NameCheck {
  if (typeof raw !== "string") return { ok: false, code: "NAME_EMPTY" };
  if (INVALID_NAME_CHARS.test(raw)) return { ok: false, code: "NAME_INVALID_CHARS" };
  const name = raw.trim().normalize("NFC");
  if (!name) return { ok: false, code: "NAME_EMPTY" };
  if ([...name].length > PRACTICE_NAME_MAX) return { ok: false, code: "NAME_TOO_LONG" };
  if (existingNames.some((existing) => nameKey(existing) === nameKey(name))) return { ok: false, code: "NAME_DUPLICATE" };
  return { ok: true, name };
}

/** Untrusted stored entry → typed entry or null (unsupported version or damaged). */
export function parsePracticeEntry(value: unknown): PracticeEntry | null {
  if (!record(value) || !exactKeys(value, ["schema_version", "id", "name", "created_at", "summary"])) return null;
  if (value.schema_version !== PRACTICE_SCHEMA_VERSION || typeof value.id !== "string" || !ID_PATTERN.test(value.id)) return null;
  const name = validatePracticeName(value.name);
  if (!name.ok || name.name !== value.name) return null;
  if (typeof value.created_at !== "string" || Number.isNaN(Date.parse(value.created_at)) || new Date(value.created_at).toISOString() !== value.created_at) return null;
  const summary = value.summary;
  if (!record(summary) || !exactKeys(summary, ["patch_id", "game_number", "selections", "positions"]) ||
    typeof summary.patch_id !== "string" || summary.patch_id.length > 80 ||
    !Number.isSafeInteger(summary.game_number) || (summary.game_number as number) < 1 || (summary.game_number as number) > 100 ||
    !Number.isSafeInteger(summary.selections) || (summary.selections as number) < 0 || (summary.selections as number) > 20 ||
    typeof summary.positions !== "boolean") return null;
  return { schema_version: PRACTICE_SCHEMA_VERSION, id: value.id, name: name.name, created_at: value.created_at,
    summary: { patch_id: summary.patch_id, game_number: summary.game_number as number, selections: summary.selections as number, positions: summary.positions } };
}

const damagedId = (value: unknown) => record(value) && typeof value.id === "string" && ID_PATTERN.test(value.id) ? value.id : null;

function storageCode(error: unknown): PracticeErrorCode {
  if (error instanceof PracticeError) return error.code;
  const name = record(error) || error instanceof Error ? (error as { name?: unknown }).name : undefined;
  return name === "QuotaExceededError" ? "QUOTA" : "FAILED";
}

type LibraryOptions = { indexedDB?: () => IDBFactory | undefined; timeoutMs?: number; now?: () => Date; newId?: () => string };

function defaultId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createPracticeLibrary(options: LibraryOptions = {}) {
  const factory = options.indexedDB ?? (() => (typeof indexedDB === "undefined" ? undefined : indexedDB));
  const timeoutMs = options.timeoutMs ?? PRACTICE_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? defaultId;

  /** Bounded open; a late success after timeout/blocked is closed and never used. */
  function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (code: PracticeErrorCode) => { if (!settled) { settled = true; clearTimeout(timer); reject(new PracticeError(code)); } };
      const timer = setTimeout(() => fail("TIMEOUT"), timeoutMs);
      try {
        const idb = factory();
        if (!idb) { fail("UNAVAILABLE"); return; }
        const request = idb.open(PRACTICE_DB_NAME, PRACTICE_DB_VERSION);
        request.onupgradeneeded = () => {
          if (settled) { request.transaction?.abort(); return; }
          const db = request.result;
          if (!db.objectStoreNames.contains(ENTRIES)) db.createObjectStore(ENTRIES, { keyPath: "id" });
          if (!db.objectStoreNames.contains(SCENARIOS)) db.createObjectStore(SCENARIOS);
        };
        request.onsuccess = () => {
          if (settled) { request.result.close(); return; }
          settled = true; clearTimeout(timer); resolve(request.result);
        };
        request.onerror = () => fail("UNAVAILABLE");
        request.onblocked = () => fail("BLOCKED");
      } catch { fail("UNAVAILABLE"); }
    });
  }

  /**
   * One bounded transaction over both stores. `work` issues requests and sets the value;
   * the promise resolves only on `complete` (committed), rejects on error/abort/timeout.
   */
  async function run<T>(mode: IDBTransactionMode, work: (tx: IDBTransaction, set: (value: T) => void, abort: (code: PracticeErrorCode) => void) => void): Promise<T> {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        let settled = false;
        let value: T | undefined;
        let failure: PracticeErrorCode | null = null;
        const finish = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };
        let tx: IDBTransaction;
        const timer = setTimeout(() => { finish(() => reject(new PracticeError("TIMEOUT"))); try { tx?.abort(); } catch { /* already finished */ } }, timeoutMs);
        try { tx = db.transaction([ENTRIES, SCENARIOS], mode); }
        catch (error) { finish(() => reject(new PracticeError(storageCode(error)))); return; }
        tx.oncomplete = () => finish(() => failure ? reject(new PracticeError(failure)) : resolve(value as T));
        tx.onerror = () => finish(() => reject(new PracticeError(failure ?? storageCode(tx.error))));
        tx.onabort = () => finish(() => reject(new PracticeError(failure ?? storageCode(tx.error))));
        try {
          work(tx, (next) => { value = next; }, (code) => { failure = code; try { tx.abort(); } catch { /* already finished */ } });
        } catch (error) {
          failure = storageCode(error);
          try { tx.abort(); } catch { /* already finished */ }
        }
      });
    } finally { db.close(); }
  }

  async function list(): Promise<PracticeList> {
    return run<PracticeList>("readonly", (tx, set) => {
      const request = tx.objectStore(ENTRIES).getAll();
      request.onsuccess = () => {
        const entries: PracticeEntry[] = [];
        const damaged: string[] = [];
        for (const raw of Array.isArray(request.result) ? request.result : []) {
          const entry = parsePracticeEntry(raw);
          if (entry) entries.push(entry);
          else damaged.push(damagedId(raw) ?? "");
        }
        entries.sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
        set({ entries, damaged });
      };
    });
  }

  /** Explicit save. Limit and duplicate names are checked inside the same readwrite transaction. */
  async function save(rawName: string, scenario: string): Promise<PracticeEntry> {
    const nameCheck = validatePracticeName(rawName);
    if (!nameCheck.ok) throw new PracticeError(nameCheck.code);
    if (typeof scenario !== "string" || new TextEncoder().encode(scenario).byteLength > MAX_DRAFT_FILE_BYTES) throw new PracticeError("TOO_LARGE");
    const parsed = parseDraftSession(scenario);
    if (!parsed.ok) throw new PracticeError("INVALID_SCENARIO", parsed.code);
    const id = newId();
    if (!ID_PATTERN.test(id)) throw new PracticeError("FAILED");
    const session = parsed.session;
    const entry: PracticeEntry = { schema_version: PRACTICE_SCHEMA_VERSION, id, name: nameCheck.name, created_at: now().toISOString(),
      summary: { patch_id: session.report.patch_id, game_number: session.games.length + 1, selections: session.selections.length, positions: Boolean(session.positions) } };
    return run<PracticeEntry>("readwrite", (tx, set, abort) => {
      const entries = tx.objectStore(ENTRIES);
      const request = entries.getAll();
      request.onsuccess = () => {
        const existing = Array.isArray(request.result) ? request.result : [];
        // Damaged/unsupported records still occupy a slot until the user deletes them.
        if (existing.length >= PRACTICE_LIMIT) { abort("LIMIT"); return; }
        const names = existing.map(parsePracticeEntry).filter((item): item is PracticeEntry => item !== null).map((item) => item.name);
        if (!validatePracticeName(entry.name, names).ok) { abort("NAME_DUPLICATE"); return; }
        entries.add(entry);
        tx.objectStore(SCENARIOS).add(scenario, id);
        set(entry);
      };
    });
  }

  /** Read + validate one practice; nothing is applied here. */
  async function read(id: string): Promise<{ entry: PracticeEntry; session: DraftSession }> {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) throw new PracticeError("NOT_FOUND");
    const raw = await run<{ entry: unknown; scenario: unknown }>("readonly", (tx, set) => {
      const result: { entry: unknown; scenario: unknown } = { entry: undefined, scenario: undefined };
      const entryRequest = tx.objectStore(ENTRIES).get(id);
      const scenarioRequest = tx.objectStore(SCENARIOS).get(id);
      entryRequest.onsuccess = () => { result.entry = entryRequest.result; set(result); };
      scenarioRequest.onsuccess = () => { result.scenario = scenarioRequest.result; set(result); };
    });
    if (raw.entry === undefined && raw.scenario === undefined) throw new PracticeError("NOT_FOUND");
    const entry = parsePracticeEntry(raw.entry);
    if (!entry || entry.id !== id || typeof raw.scenario !== "string") throw new PracticeError("CORRUPT");
    if (new TextEncoder().encode(raw.scenario).byteLength > MAX_DRAFT_FILE_BYTES) throw new PracticeError("TOO_LARGE");
    const parsed = parseDraftSession(raw.scenario);
    if (!parsed.ok) throw new PracticeError("INVALID_SCENARIO", parsed.code);
    return { entry, session: parsed.session };
  }

  /** Delete one practice (entry and scenario together). Damaged entries with an ID are deletable. */
  async function remove(id: string): Promise<void> {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) throw new PracticeError("NOT_FOUND");
    await run<void>("readwrite", (tx, set) => {
      tx.objectStore(ENTRIES).delete(id);
      tx.objectStore(SCENARIOS).delete(id);
      set(undefined);
    });
  }

  return { list, save, read, remove };
}

export type PracticeLibrary = ReturnType<typeof createPracticeLibrary>;

/**
 * Guards delayed loads/confirmations. `observe` is called after each committed render with the
 * caller's current board identity and lock state; any change bumps a revision (so A→B→A still
 * invalidates). A ticket taken when the user acted is only valid while both revisions match
 * and the panel is unlocked — a late read can never silently replace newer work.
 */
export type PracticeLoadTicket = { board: number; lock: number };
export type PracticeGateResult = "OK" | "LOCKED" | "LOCK_CHANGED" | "BOARD_CHANGED";
export function createPracticeLoadGate() {
  let board = 0, lock = 0, locked = false;
  let seenKey: string | null = null, seenLocked: boolean | null = null;
  return {
    observe(boardKey: string, isLocked: boolean) {
      if (seenKey !== null && boardKey !== seenKey) board++;
      if (seenLocked !== null && isLocked !== seenLocked) lock++;
      seenKey = boardKey; seenLocked = isLocked; locked = isLocked;
    },
    ticket(): PracticeLoadTicket { return { board, lock }; },
    check(ticket: PracticeLoadTicket): PracticeGateResult {
      if (locked) return "LOCKED";
      if (ticket.lock !== lock) return "LOCK_CHANGED";
      if (ticket.board !== board) return "BOARD_CHANGED";
      return "OK";
    },
  };
}
export const PRACTICE_GATE_TEXT: Record<Exclude<PracticeGateResult, "OK">, string> = {
  LOCKED: "친구 방 사용 중이거나 다른 불러오기 중이라 적용하지 않았습니다.",
  LOCK_CHANGED: "친구 방이나 불러오기 상태가 바뀌어 적용하지 않았습니다. 필요하면 다시 열어 주세요.",
  BOARD_CHANGED: "불러오는 사이 현재 밴픽이 바뀌어 적용하지 않았습니다. 필요하면 다시 열어 주세요.",
};

export const PRACTICE_ERROR_TEXT: Record<PracticeErrorCode, string> = {
  NAME_EMPTY: "연습 이름을 입력하세요.",
  NAME_TOO_LONG: `이름은 ${PRACTICE_NAME_MAX}자 이내로 입력하세요.`,
  NAME_INVALID_CHARS: "이름에 줄바꿈이나 제어 문자를 넣을 수 없습니다.",
  NAME_DUPLICATE: "같은 이름의 연습이 이미 있습니다. 다른 이름을 쓰세요.",
  LIMIT: `보관함은 최대 ${PRACTICE_LIMIT}개입니다. 기존 연습을 삭제한 뒤 저장하세요.`,
  INVALID_SCENARIO: "저장된 밴픽 자료가 올바르지 않아 불러오지 않았습니다.",
  TOO_LARGE: "연습 자료가 너무 커서 처리하지 않았습니다.",
  QUOTA: "기기 저장 공간이 부족해 저장하지 못했습니다.",
  BLOCKED: "다른 탭이 보관함을 사용 중입니다. 다른 탭을 닫고 다시 시도하세요.",
  TIMEOUT: "보관함 응답이 늦어 중단했습니다. 목록을 다시 확인하세요.",
  UNAVAILABLE: "이 브라우저에서는 보관함을 사용할 수 없습니다.",
  NOT_FOUND: "이 연습을 찾을 수 없습니다. 다른 탭에서 삭제되었을 수 있습니다.",
  CORRUPT: "보관 항목이 손상되어 불러오지 않았습니다.",
  FAILED: "보관함 작업에 실패했습니다. 기존 항목은 그대로 있습니다.",
};
export const practiceErrorText = (error: unknown) => PRACTICE_ERROR_TEXT[error instanceof PracticeError ? error.code : "FAILED"];
