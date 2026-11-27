import { randomBytes, timingSafeEqual } from "node:crypto";
import { championAssetId } from "../app/champion-assets";
import { SHARE_CHAMPIONS } from "../app/share-champion-ids";
import { applyDraftSelection, completeFearlessGame, DRAFT_MODEL_VERSION, fearlessLocks, nextDraftTurn, type DraftSelection, type DraftGame, type DraftSide } from "../app/draft-agent";
import { parseDraftShareUrl } from "../app/draft-share";
import { isRadarReport, type RadarReport } from "../app/radar-types";
import { actionFingerprint, decodeState, encodeState, feedIdentity, MAX_PERSISTED_ACTIONS, type DraftRoomPersistence, type FeedIdentity, type PersistedRoom } from "./draft-room-persistence";

export type RoomRole = DraftSide | "SPECTATOR";
export type RoomSnapshot = {
  id: string; revision: number; patch_id: string; cutoff: string; model_version: string;
  blueTeamId: string; redTeamId: string; firstPickSide: DraftSide;
  selections: DraftSelection[]; games: DraftGame[]; seats: { BLUE: true; RED: boolean };
  status: "WAITING" | "DRAFTING" | "COMPLETE"; expiresAt: string;
};
export class RoomError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
type Listener = (snapshot: RoomSnapshot | null) => void;
type Entry = {
  snapshot: RoomSnapshot; host: string; guest: string | null; invite: string; view: string;
  actions: Map<string, string>; listeners: Set<Listener>;
  /** The validated public report this room was created with; it never changes for the room. */
  report: RadarReport;
};
const canonical = new Map(SHARE_CHAMPIONS.flatMap(([name, id]) => [[championAssetId(name).toLowerCase(), id], [id.toLowerCase(), id]] as [string, string][]));
const secret = () => randomBytes(24).toString("base64url");
const same = (a: string, b: string) => {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RoomError(400, "BAD_REQUEST", "요청을 읽을 수 없습니다.");
  return value as Record<string, unknown>;
};

const statusOf = (snapshot: RoomSnapshot): RoomSnapshot["status"] =>
  !snapshot.seats.RED ? "WAITING" : snapshot.selections.length === 20 ? "COMPLETE" : "DRAFTING";

/**
 * One authoritative server store. Ephemeral by default; with an explicit `persistence` backend every
 * mutation is written atomically before it is applied in memory, acknowledged or broadcast.
 * Never distribute credentials with snapshots.
 */
export class DraftRoomStore {
  private rooms = new Map<string, Entry>();
  private report: RadarReport;
  private identity: FeedIdentity;
  constructor(report: RadarReport, private options: { clock?: () => number; ttlMs?: number; maxRooms?: number; maxListeners?: number; persistence?: DraftRoomPersistence } = {}) {
    if (!isRadarReport(report) || !report.opponent_prep) throw new Error("A validated public report is required");
    this.report = structuredClone(report);
    this.identity = feedIdentity(this.report);
    const text = options.persistence?.load() ?? null;
    if (text !== null) {
      const restored = decodeState(text, { report: this.report, identity: this.identity, now: this.now(), ttlMs: this.ttl(), maxRooms: options.maxRooms ?? 200 });
      for (const room of restored) this.rooms.set(room.snapshot.id, { ...room, actions: new Map(room.actions), listeners: new Set(), report: this.report });
    }
  }
  get storage(): "ephemeral" | "file" { return this.options.persistence ? "file" : "ephemeral"; }
  /** Patch and cutoff that new rooms are created with (existing rooms keep the values in their snapshot). */
  get feed() { return { patch_id: this.report.patch_id, cutoff: this.report.cutoff }; }
  /**
   * Validated refresh for new rooms only. Live rooms never read the report after creation, so they finish on
   * the data they were created with. An invalid report is rejected and the last valid one stays.
   * Not available with a persistence file: its single feed identity would refuse the older rooms on restart.
   */
  replaceReport(report: unknown): boolean {
    if (this.options.persistence) throw new Error("Feed reload cannot be combined with room persistence");
    if (!isRadarReport(report) || !report.opponent_prep) throw new Error("A validated public report is required");
    const next = structuredClone(report), identity = feedIdentity(next);
    if (identity.sha256 === this.identity.sha256) return false;
    this.report = next; this.identity = identity;
    return true;
  }
  private now() { return this.options.clock?.() ?? Date.now(); }
  private ttl() { return this.options.ttlMs ?? 2 * 60 * 60 * 1000; }
  /** Writes all live rooms (with `candidate` replacing/adding its room) or throws without side effects. */
  private persist(candidate?: Entry) {
    const persistence = this.options.persistence;
    if (!persistence) return;
    const now = this.now(), rooms: PersistedRoom[] = [], entries = new Map(this.rooms);
    if (candidate) entries.set(candidate.snapshot.id, candidate);
    for (const entry of entries.values()) {
      if (Date.parse(entry.snapshot.expiresAt) <= now) continue;
      rooms.push({ snapshot: entry.snapshot, host: entry.host, guest: entry.guest, invite: entry.invite, view: entry.view, actions: [...entry.actions] });
    }
    try { persistence.save(encodeState(this.identity, rooms, now)); }
    catch { throw new RoomError(503, "STORAGE_UNAVAILABLE", "방 상태를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요."); }
  }
  /** Expiry is deterministic and restore drops expired rooms, so pruning the file is best effort. */
  private prune() { try { this.persist(); } catch { /* retried on the next successful write */ } }
  sweep() {
    let removed = false;
    for (const [id, entry] of this.rooms) if (Date.parse(entry.snapshot.expiresAt) <= this.now()) { this.remove(id, entry); removed = true; }
    if (removed) this.prune();
  }
  private remove(id: string, entry: Entry) {
    this.rooms.delete(id);
    for (const listener of entry.listeners) { try { listener(null); } catch { /* closed connection */ } }
    entry.listeners.clear();
  }
  private entry(id: string) {
    const entry = this.rooms.get(id);
    if (!entry) throw new RoomError(404, "ROOM_NOT_FOUND", "방이 닫혔거나 주소가 올바르지 않습니다.");
    if (Date.parse(entry.snapshot.expiresAt) <= this.now()) {
      this.remove(id, entry); this.prune();
      throw new RoomError(410, "ROOM_EXPIRED", "방의 이용 시간이 끝났습니다. 새 방을 만들어 주세요.");
    }
    return entry;
  }
  private role(entry: Entry, token: unknown): RoomRole {
    if (typeof token !== "string" || token.length !== 32) throw new RoomError(401, "UNAUTHORIZED", "방 참여 정보를 확인해 주세요.");
    if (same(token, entry.host)) return "BLUE";
    if (entry.guest && same(token, entry.guest)) return "RED";
    if (same(token, entry.view)) return "SPECTATOR";
    throw new RoomError(401, "UNAUTHORIZED", "방 참여 정보를 확인해 주세요.");
  }
  private snapshot(entry: Entry) { return structuredClone(entry.snapshot); }
  private notify(entry: Entry) {
    for (const listener of entry.listeners) {
      try { listener(this.snapshot(entry)); } catch { entry.listeners.delete(listener); }
    }
  }
  create(body: unknown) {
    const value = object(body);
    if (typeof value.share !== "string" || value.share.length > 12_000 || !value.share.startsWith("#draft=")) throw new RoomError(400, "INVALID_SETUP", "현재 밴픽을 확인한 뒤 다시 방을 만들어 주세요.");
    let session;
    try { session = parseDraftShareUrl(`https://room.invalid/${value.share}`, this.report); }
    catch { throw new RoomError(400, "INVALID_SETUP", "팀·패치 또는 밴픽 순서가 현재 방 자료와 다릅니다."); }
    this.sweep();
    if (this.rooms.size >= (this.options.maxRooms ?? 200)) throw new RoomError(429, "ROOM_LIMIT", "지금은 새 방을 만들 수 없습니다. 잠시 후 다시 시도해 주세요.");
    const id = randomBytes(16).toString("base64url");
    const entry: Entry = {
      snapshot: { id, revision: 0, patch_id: this.report.patch_id, cutoff: this.report.cutoff,
        model_version: DRAFT_MODEL_VERSION, blueTeamId: session.blueTeamId, redTeamId: session.redTeamId,
        firstPickSide: session.firstPickSide, selections: session.selections, games: session.games,
        seats: { BLUE: true, RED: false }, status: "WAITING",
        expiresAt: new Date(this.now() + this.ttl()).toISOString() },
      host: secret(), guest: null, invite: secret(), view: secret(), actions: new Map(), listeners: new Set(), report: this.report,
    };
    this.persist(entry);
    this.rooms.set(id, entry);
    return { id, role: "BLUE" as const, token: entry.host, snapshot: this.snapshot(entry), invite: entry.invite, view: entry.view };
  }
  join(id: string, body: unknown) {
    const entry = this.entry(id), value = object(body);
    if (typeof value.view === "string" && same(value.view, entry.view)) return { id, role: "SPECTATOR" as const, token: entry.view, snapshot: this.snapshot(entry) };
    if (typeof value.invite !== "string" || !same(value.invite, entry.invite)) throw new RoomError(401, "INVALID_INVITE", "초대 링크가 올바르지 않습니다.");
    if (entry.guest) throw new RoomError(409, "SEAT_TAKEN", "레드 자리는 이미 참여했습니다. 참여했던 창에서 다시 연결해 주세요.");
    const guest = secret(), snapshot = structuredClone(entry.snapshot);
    snapshot.seats.RED = true; snapshot.revision++; snapshot.status = statusOf(snapshot);
    this.persist({ ...entry, guest, snapshot });
    entry.guest = guest; entry.snapshot = snapshot;
    this.notify(entry);
    return { id, role: "RED" as const, token: entry.guest, snapshot: this.snapshot(entry) };
  }
  /** The room's own report (public data) for an authorized participant, so every screen validates and analyses on it. */
  roomReport(id: string, token: unknown): RadarReport {
    const entry = this.entry(id); this.role(entry, token);
    return entry.report;
  }
  read(id: string, token: unknown) {
    const entry = this.entry(id);
    const role = this.role(entry, token);
    return { id, role, snapshot: this.snapshot(entry),
      ...(role === "BLUE" ? { invite: entry.invite, view: entry.view } : {}) };
  }
  subscribe(id: string, token: unknown, listener: Listener) {
    const entry = this.entry(id); this.role(entry, token);
    if (entry.listeners.size >= (this.options.maxListeners ?? 24)) throw new RoomError(429, "CONNECTION_LIMIT", "이 방의 연결이 많습니다. 잠시 후 다시 참여해 주세요.");
    entry.listeners.add(listener);
    listener(this.snapshot(entry));
    return () => { entry.listeners.delete(listener); };
  }
  act(id: string, token: unknown, body: unknown) {
    const entry = this.entry(id), role = this.role(entry, token), value = object(body);
    if (role === "SPECTATOR") throw new RoomError(403, "READ_ONLY", "관전자는 밴픽을 바꿀 수 없습니다.");
    if (typeof value.id !== "string" || !/^[A-Za-z0-9_-]{12,80}$/.test(value.id) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 || typeof value.kind !== "string" || !["SELECT", "NEXT_GAME", "RESET"].includes(value.kind)) throw new RoomError(400, "BAD_ACTION", "밴픽 요청을 확인해 주세요.");
    const key = `${role}:${value.id}`, fingerprint = actionFingerprint(value.kind, value.championId);
    if (entry.actions.has(key)) {
      if (entry.actions.get(key) !== fingerprint) throw new RoomError(409, "ACTION_ID_REUSED", "같은 요청 번호로 다른 동작을 보낼 수 없습니다.");
      return this.read(id, token);
    }
    if (value.revision !== entry.snapshot.revision) throw new RoomError(409, "REVISION_CONFLICT", "상대의 밴픽을 반영 중입니다. 최신 화면에서 다시 선택해 주세요.");
    const snapshot = structuredClone(entry.snapshot);
    if (value.kind === "SELECT") {
      if (!snapshot.seats.RED) throw new RoomError(409, "WAITING_FOR_RED", "상대가 참여하면 밴픽을 시작할 수 있습니다.");
      const turn = nextDraftTurn(snapshot.selections, snapshot.firstPickSide);
      if (!turn) throw new RoomError(409, "DRAFT_COMPLETE", "밴픽이 끝났습니다.");
      if (turn.side !== role) throw new RoomError(403, "NOT_YOUR_TURN", "상대 차례입니다.");
      const id = typeof value.championId === "string" && value.championId.length <= 80 ? canonical.get(championAssetId(value.championId).toLowerCase()) : null;
      if (!id) throw new RoomError(400, "UNKNOWN_CHAMPION", "챔피언을 확인해 주세요.");
      const next = applyDraftSelection(snapshot.selections, id, fearlessLocks(snapshot.games), snapshot.firstPickSide);
      if (next === snapshot.selections) throw new RoomError(409, "CHAMPION_LOCKED", "이미 선택했거나 이전 세트에서 사용한 챔피언입니다.");
      snapshot.selections = next;
    } else {
      if (role !== "BLUE") throw new RoomError(403, "HOST_ONLY", "방장만 세트를 바꿀 수 있습니다.");
      if (value.kind === "NEXT_GAME") {
        if (snapshot.games.length >= 9) throw new RoomError(409, "SERIES_LIMIT", "이 방에서는 최대 10세트까지 진행할 수 있습니다.");
        const next = completeFearlessGame(snapshot.games, { blue_team_id: snapshot.blueTeamId, red_team_id: snapshot.redTeamId, selections: snapshot.selections });
        if (next === snapshot.games) throw new RoomError(409, "DRAFT_INCOMPLETE", "밴픽을 모두 마친 뒤 다음 세트로 이동할 수 있습니다.");
        snapshot.games = next;
      } else snapshot.games = [];
      snapshot.selections = [];
    }
    snapshot.revision++; snapshot.status = statusOf(snapshot);
    const actions = new Map(entry.actions);
    actions.set(key, fingerprint);
    if (actions.size > MAX_PERSISTED_ACTIONS) actions.delete(actions.keys().next().value!);
    this.persist({ ...entry, snapshot, actions });
    entry.snapshot = snapshot; entry.actions = actions;
    this.notify(entry);
    return this.read(id, token);
  }
}
