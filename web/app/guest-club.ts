import { basisKey, ROSTER_ROLES, validateRosters, type RosterBasis, type RosterIndex, type RosterSlots, type RosterState } from "./roster-scenario";

export const CLUB_STORAGE_KEY = "pro-meta-guest-clubs-v1";
export const MAX_CLUBS = 10;
const MAX_BYTES = 768 * 1024;
export type GuestClub = { id: string; revision: number; name: string; headCoach: string; assistantCoach: string; baseTeamId: string; basis: RosterBasis; slots: RosterSlots; createdAt: string; updatedAt: string };
export type ClubLibrary = { artifact_type: "guest-clubs"; schema_version: 1; clubs: GuestClub[] };
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const text = (x: unknown, limit = 60): x is string => typeof x === "string" && x.length <= limit && !Array.from(x).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const date = (x: unknown): x is string => typeof x === "string" && x.length <= 40 && Number.isFinite(Date.parse(x));
const uuid = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
export function parseClubLibrary(raw: string | null): ClubLibrary {
  if (raw === null) return { artifact_type: "guest-clubs", schema_version: 1, clubs: [] };
  if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) throw new Error("구단 저장 자료가 너무 큽니다. 기존 자료를 유지합니다.");
  let x: unknown;
  try { x = JSON.parse(raw); } catch { throw new Error("저장된 구단 자료를 읽지 못했습니다. 기존 자료를 유지합니다."); }
  if (!object(x) || x.artifact_type !== "guest-clubs" || x.schema_version !== 1 || !Array.isArray(x.clubs) || x.clubs.length > MAX_CLUBS) throw new Error("지원하지 않는 구단 저장 형식입니다. 기존 자료를 유지합니다.");
  const ids = new Set<string>();
  for (const c of x.clubs) {
    if (!object(c) || !uuid(c.id) || ids.has(c.id) || !Number.isSafeInteger(c.revision) || (c.revision as number) < 1 || !text(c.name, 40) || !c.name.trim() || !text(c.headCoach) || !text(c.assistantCoach) || !text(c.baseTeamId, 256) || !c.baseTeamId || !date(c.createdAt) || !date(c.updatedAt) || Date.parse(c.updatedAt) < Date.parse(c.createdAt)) throw new Error("구단 정보가 올바르지 않습니다. 기존 자료를 유지합니다.");
    ids.add(c.id);
    const b = c.basis;
    if (!object(b) || !text(b.patch_id, 80) || !date(b.cutoff) || typeof b.fixture_only !== "boolean" || !Array.isArray(b.source_versions) || b.source_versions.length > 100 || !b.source_versions.every(s => text(s, 1024))) throw new Error("구단의 자료 기준을 확인하지 못했습니다.");
    if (!object(c.slots) || Object.keys(c.slots).length !== 5 || !ROSTER_ROLES.every(role => Object.hasOwn(c.slots as object, role))) throw new Error("구단 선수 자리가 올바르지 않습니다.");
    const players = new Set<string>();
    for (const role of ROSTER_ROLES) {
      const p = c.slots[role];
      if (p === null) continue;
      if (!object(p) || Object.keys(p).length !== 2 || !text(p.source_team_id, 256) || !p.source_team_id || !text(p.player_id, 256) || !p.player_id || players.has(p.player_id)) throw new Error("구단 선수 정보가 중복되거나 올바르지 않습니다.");
      players.add(p.player_id);
    }
  }
  return x as ClubLibrary;
}

/** A saved club never silently migrates to another evidence snapshot or moves an opponent. */
export function applyGuestClub(club: GuestClub, teamId: string, state: RosterState, basis: RosterBasis, index: RosterIndex): RosterState {
  if (basisKey(club.basis) !== basisKey(basis)) throw new Error("저장 때와 자료 기준이 달라 불러오지 않았습니다. 기존 구단은 보관됩니다.");
  if (!Object.hasOwn(state, teamId)) throw new Error("적용할 진영을 찾지 못했습니다.");
  const next = structuredClone(state);
  next[teamId] = structuredClone(club.slots);
  const checked = validateRosters(next, Object.keys(next), index);
  if (!checked.ok) throw new Error(checked.code === "DUPLICATE_PLAYER" ? "상대 로스터와 같은 선수가 있어 불러오지 않았습니다. 상대 선수를 먼저 바꿔 주세요." : checked.error);
  return checked.value;
}

/** All UI writers use the same origin-wide lock; no unsafe fallback on older browsers. */
export async function withClubWriteLock<T>(action: () => T): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks?.request) throw new Error("이 브라우저에서는 안전한 구단 저장을 지원하지 않습니다. 최신 브라우저로 이용해 주세요.");
  return navigator.locks.request(CLUB_STORAGE_KEY, action);
}

/** Caller holds withClubWriteLock. Denied/full storage never reports success. */
export function saveGuestClub(storage: Storage, club: GuestClub): ClubLibrary {
  const library = parseClubLibrary(storage.getItem(CLUB_STORAGE_KEY));
  if (library.clubs.some(c => c.id === club.id)) throw new Error("이미 저장된 구단입니다.");
  if (library.clubs.length >= MAX_CLUBS) throw new Error("구단은 최대 10개까지 저장할 수 있습니다.");
  const next = parseClubLibrary(JSON.stringify({ ...library, clubs: [...library.clubs, club] }));
  storage.setItem(CLUB_STORAGE_KEY, JSON.stringify(next));
  return next;
}
export function deleteGuestClub(storage: Storage, id: string): ClubLibrary {
  const library = parseClubLibrary(storage.getItem(CLUB_STORAGE_KEY));
  if (!library.clubs.some(c => c.id === id)) throw new Error("이미 삭제된 구단입니다. 목록을 다시 확인해 주세요.");
  const next = { ...library, clubs: library.clubs.filter(c => c.id !== id) };
  storage.setItem(CLUB_STORAGE_KEY, JSON.stringify(next));
  return next;
}
