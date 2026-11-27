import { DRAFT_MODEL_VERSION, nextDraftTurn, serializeDraftScenario } from "./draft-agent";
import { parseDraftSession, type DraftSession } from "./draft-session";
import { isRadarReport, type RadarReport } from "./radar-types";

export type RoomRole = "BLUE" | "RED" | "SPECTATOR";
export type RoomLink = { v: 1; id: string; invite?: string; view?: string };
export type RoomSnapshot = { id: string; revision: number; patch_id: string; cutoff: string; model_version: string; blueTeamId: string; redTeamId: string; firstPickSide: "BLUE" | "RED"; selections: DraftSession["selections"]; games: DraftSession["games"]; seats: { BLUE: true; RED: boolean }; status: "WAITING" | "DRAFTING" | "COMPLETE"; expiresAt: string };
type Credential = { id: string; role: RoomRole; token: string };
const idPattern = /^[A-Za-z0-9_-]{22}$/;
const keyPattern = /^[A-Za-z0-9_-]{32}$/;
class RoomRequestError extends Error {
  constructor(public status: number) {
    super(status === 409 ? "다른 선택이 먼저 반영되었습니다. 최신 밴픽을 확인해 주세요." : status === 404 || status === 410 ? "방이 종료되었거나 만료되었습니다." : status === 401 ? "방 참여 정보를 확인할 수 없습니다. 참여했던 창이나 새 초대 링크를 확인해 주세요." : "방에 참여할 수 없습니다. 초대 링크와 참여 권한을 확인해 주세요.");
  }
  get terminal() { return [401, 404, 410].includes(this.status); }
}
/**
 * A room is pinned to the public report it was created with. When this screen's report differs, the room's
 * own report is loaded from the server and every snapshot is validated (and analysed) on it. If it cannot be
 * loaded or does not match the room, the room view ends with an explanation instead of retrying forever.
 */
export class RoomDataUnavailableError extends Error {
  readonly terminal = true;
  constructor(public roomPatch: string, public roomCutoff: string) {
    super(`이 방은 패치 ${roomPatch} 자료(기준 ${roomCutoff.slice(0, 10)})로 진행 중인데, 그 자료를 불러오지 못했어요. 혼자 연습으로 돌아가 새 방을 만들어 주세요.`);
  }
}
const invalid = () => new Error("방 정보를 확인할 수 없습니다. 초대 링크와 현재 자료를 확인해 주세요.");
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const encode = (x: unknown) => btoa(JSON.stringify(x)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
export function parseRoomLink(href: string): RoomLink | null {
  const hash = new URL(href).hash;
  if (!hash.startsWith("#room=")) return null;
  const data = hash.slice(6);
  if (data.length > 512 || !/^[A-Za-z0-9_-]+$/.test(data)) throw invalid();
  let x: unknown;
  try { x = JSON.parse(atob(data.replaceAll("-", "+").replaceAll("_", "/"))); } catch { throw invalid(); }
  if (!record(x) || x.v !== 1 || typeof x.id !== "string" || !idPattern.test(x.id) || Object.keys(x).some(k => !["v", "id", "invite", "view"].includes(k)) || (x.invite !== undefined && x.view !== undefined) || (x.invite !== undefined && (typeof x.invite !== "string" || !keyPattern.test(x.invite))) || (x.view !== undefined && (typeof x.view !== "string" || !keyPattern.test(x.view))) || encode(x) !== data) throw invalid();
  return x as RoomLink;
}
export function createRoomUrl(href: string, id: string, kind?: "invite" | "view", key?: string): string {
  if (!idPattern.test(id) || (kind && (!key || !keyPattern.test(key)))) throw invalid();
  const url = new URL(href); url.search = ""; url.hash = "room=" + encode({ v: 1, id, ...(kind ? { [kind]: key } : {}) }); return url.href;
}
export function validateRoomSnapshot(value: unknown, report: RadarReport): { snapshot: RoomSnapshot; session: DraftSession } {
  if (!record(value) || typeof value.id !== "string" || !idPattern.test(value.id) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 || value.patch_id !== report.patch_id || value.cutoff !== report.cutoff || value.model_version !== DRAFT_MODEL_VERSION || !record(value.seats) || value.seats.BLUE !== true || typeof value.seats.RED !== "boolean" || Object.keys(value.seats).some(k => k !== "BLUE" && k !== "RED") || !["WAITING", "DRAFTING", "COMPLETE"].includes(String(value.status)) || typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt)) || !Array.isArray(value.selections) || !Array.isArray(value.games) || value.games.length > 99 || !["BLUE", "RED"].includes(String(value.firstPickSide))) throw invalid();
  const allowed = ["id", "revision", "patch_id", "cutoff", "model_version", "blueTeamId", "redTeamId", "firstPickSide", "selections", "games", "seats", "status", "expiresAt"];
  if (Object.keys(value).some(k => !allowed.includes(k))) throw invalid();
  const snapshot = value as RoomSnapshot;
  const teams = report.opponent_prep?.teams ?? [];
  const blue = teams.find(t => t.team_id === snapshot.blueTeamId), red = teams.find(t => t.team_id === snapshot.redTeamId);
  if (!blue || !red || blue === red || snapshot.status !== (!snapshot.seats.RED ? "WAITING" : snapshot.selections.length === 20 ? "COMPLETE" : "DRAFTING")) throw invalid();
  const result = parseDraftSession(serializeDraftScenario(report, blue, red, snapshot.selections, snapshot.games, null, snapshot.firstPickSide));
  if (!result.ok) throw invalid();
  // Return only validated public fields; private capabilities never enter draft state.
  return { snapshot: { ...snapshot, selections: result.session.selections, games: result.session.games }, session: result.session };
}
export function createCredentialStore(storage: () => Storage = () => sessionStorage) {
  const memory = new Map<string, Credential>();
  let warning = false;
  const valid = (x: unknown): x is Credential => record(x) && typeof x.id === "string" && idPattern.test(x.id) && typeof x.token === "string" && keyPattern.test(x.token) && ["BLUE", "RED", "SPECTATOR"].includes(String(x.role));
  return {
    get warning() { return warning; },
    get(id: string): Credential | null {
      if (!idPattern.test(id)) return null;
      if (memory.has(id)) return memory.get(id)!;
      try { const raw = storage().getItem("draft-room:" + id); if (!raw || raw.length > 256) return null; const x: unknown = JSON.parse(raw); if (valid(x) && x.id === id) { memory.set(id, x); while (memory.size > 16) memory.delete(memory.keys().next().value!); return x; } } catch { warning = true; }
      return null;
    },
    set(x: Credential) {
      if (!valid(x)) throw invalid();
      memory.delete(x.id); memory.set(x.id, x);
      while (memory.size > 16) memory.delete(memory.keys().next().value!);
      try {
        const s = storage(); s.setItem("draft-room:" + x.id, JSON.stringify(x));
        const keys = Array.from({ length: s.length }, (_, i) => s.key(i)).filter((k): k is string => !!k && k.startsWith("draft-room:"));
        for (const k of keys.filter(k => k !== "draft-room:" + x.id).slice(0, Math.max(0, keys.length - 16))) s.removeItem(k);
      } catch { warning = true; }
    },
    /** Drops the credential of a room that has ended, so the screen stops offering to rejoin it. */
    delete(id: string) {
      memory.delete(id);
      try { storage().removeItem("draft-room:" + id); } catch { warning = true; }
    },
  };
}
export async function fetchNDJSON(response: Response, signal: AbortSignal, onValue: (value: unknown) => void) {
  if (!response.ok) throw new RoomRequestError(response.status);
  if (!response.body || !response.headers.get("content-type")?.includes("application/x-ndjson")) throw invalid();
  const reader = response.body.getReader(); const decoder = new TextDecoder("utf-8", { fatal: true }); let buffer = "";
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  const line = (s: string) => { if (s.trim() && !signal.aborted) onValue(JSON.parse(s)); };
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length > 262144) throw invalid();
      let end: number; while ((end = buffer.indexOf("\n")) >= 0) { line(buffer.slice(0, end)); buffer = buffer.slice(end + 1); }
      if (done) { if (buffer.trim()) line(buffer); break; }
    }
  } finally { signal.removeEventListener("abort", abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export type RoomState = { active: boolean; connected: boolean; sending: boolean; ended?: boolean; role?: RoomRole; snapshot?: RoomSnapshot; warning?: boolean; message?: string; invite?: string; view?: string };
export class DraftRoomClient {
  private controller = new AbortController(); private generation = 0; private credential?: Credential; private state: RoomState = { active: false, connected: false, sending: false };
  /** The room's own report when it differs from this screen's (loaded once per room and identity). */
  private pinned: { id: string; report: RadarReport } | null = null;
  constructor(private endpoint: string, private report: () => RadarReport, private onState: (s: RoomState) => void, private onSnapshot: (session: DraftSession, reset: boolean) => void, private store = createCredentialStore(), private request: typeof fetch = (...args) => fetch(...args)) { this.endpoint = endpoint.replace(/\/$/, ""); }
  credentialFor(id: string) { return !!this.store.get(id); }
  forget(id: string) { this.store.delete(id); }
  reconnect() {
    if (!this.credential || !this.state.active || this.state.ended) return;
    this.controller.abort(); this.controller = new AbortController(); this.generation++;
    this.update({ connected: false, sending: false, message: "연결을 다시 확인하고 있습니다. 잠시 기다려 주세요." });
    void this.listen(this.generation, this.credential);
  }
  private update(patch: Partial<RoomState>) { this.state = { ...this.state, ...patch }; this.onState(this.state); }
  private async http(path: string, method = "GET", body?: unknown, credential?: Credential): Promise<Record<string, unknown>> {
    const response = await this.request(this.endpoint + path, { method, signal: this.controller.signal, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(credential ? { Authorization: "Bearer " + credential.token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), credentials: "omit", cache: "no-store" });
    if (!response.ok) throw new RoomRequestError(response.status);
    const data: unknown = await response.json();
    if (!record(data)) throw invalid(); return data;
  }
  /** The report a snapshot is validated and analysed on: this screen's when it is the room's, else the loaded room report. */
  private reportFor(value: unknown, id: string): RadarReport | null {
    if (!record(value)) return null;
    const live = this.report();
    if (value.patch_id === live.patch_id && value.cutoff === live.cutoff) return live;
    const pinned = this.pinned;
    return pinned && pinned.id === id && value.patch_id === pinned.report.patch_id && value.cutoff === pinned.report.cutoff ? pinned.report : null;
  }
  /** Loads the room's report when needed; it must be a valid public report with exactly the room's patch and cutoff. */
  private async ensureReport(value: unknown, credential: Credential) {
    if (this.reportFor(value, credential.id)) return;
    if (!record(value) || typeof value.patch_id !== "string" || typeof value.cutoff !== "string") throw invalid();
    let data: unknown;
    try { data = await this.http(`/v1/rooms/${credential.id}/report`, "GET", undefined, credential); }
    catch (error) { if (error instanceof RoomRequestError && error.terminal) throw error; throw new RoomDataUnavailableError(value.patch_id, value.cutoff); }
    if (!isRadarReport(data) || data.patch_id !== value.patch_id || data.cutoff !== value.cutoff) throw new RoomDataUnavailableError(value.patch_id, value.cutoff);
    this.pinned = { id: credential.id, report: data };
  }
  private accept(value: unknown, id: string, first = false) {
    const report = this.reportFor(value, id);
    if (!report) throw invalid();
    const { snapshot, session } = validateRoomSnapshot(value, report);
    if (snapshot.id !== id) throw invalid();
    const previous = this.state.snapshot;
    if (previous && snapshot.revision <= previous.revision) return;
    this.onSnapshot(session, first || !!previous && snapshot.games.length === 0 && snapshot.selections.length === 0 && (previous.games.length > 0 || previous.selections.length > 0));
    this.update({ snapshot });
  }
  async enter(input: { share: string } | RoomLink) {
    this.leave(); const generation = this.generation; this.update({ active: true, sending: true, message: "방에 참여하는 중" });
    try {
      if ("share" in input) { if (typeof input.share !== "string" || !input.share.startsWith("#draft=") || input.share.length > 12000) throw invalid(); }
      else { parseRoomLink("https://room.invalid/#room=" + encode(input)); }
      const existing = "id" in input ? this.store.get(input.id) : null;
      if (!("share" in input) && !existing && !input.invite && !input.view) throw invalid();
      const data = "share" in input ? await this.http("/v1/rooms", "POST", input) : existing ? await this.http(`/v1/rooms/${input.id}`, "GET", undefined, existing) : await this.http(`/v1/rooms/${input.id}/join`, "POST", input.invite ? { invite: input.invite } : { view: input.view });
      if (generation !== this.generation) return;
      const credential = existing ?? { id: data.id, role: data.role, token: data.token } as Credential;
      if (!idPattern.test(credential.id) || !keyPattern.test(credential.token) || !["BLUE", "RED", "SPECTATOR"].includes(credential.role) || data.id !== credential.id || data.role !== credential.role || ("id" in input && input.id !== credential.id)) throw invalid();
      if ("share" in input && (credential.role !== "BLUE" || typeof data.invite !== "string" || !keyPattern.test(data.invite) || typeof data.view !== "string" || !keyPattern.test(data.view) || data.invite === credential.token || data.view === credential.token)) throw invalid();
      for (const kind of ["invite", "view"] as const) {
        if (data[kind] !== undefined && (credential.role !== "BLUE" || typeof data[kind] !== "string" || !keyPattern.test(data[kind]) || data[kind] === credential.token)) throw invalid();
      }
      if (!existing && "id" in input && credential.role !== (input.invite ? "RED" : "SPECTATOR")) throw invalid();
      await this.ensureReport(data.snapshot, credential);
      if (generation !== this.generation) return;
      this.accept(data.snapshot, credential.id, true); this.credential = credential; this.store.set(credential);
      this.update({ role: credential.role, sending: false, warning: this.store.warning, invite: typeof data.invite === "string" ? data.invite : undefined, view: typeof data.view === "string" ? data.view : undefined, message: "" });
      void this.listen(generation, credential);
    } catch (error) { if (generation === this.generation) this.update({ sending: false, connected: false, message: error instanceof RoomDataUnavailableError ? error.message : "방에 참여하지 못했습니다. 링크와 현재 자료를 확인해 주세요." }); }
  }
  private async listen(generation: number, credential: Credential) {
    let attempt = 0; const signal = this.controller.signal;
    while (!signal.aborted && generation === this.generation) {
      try {
        const latest = await this.http(`/v1/rooms/${credential.id}`, "GET", undefined, credential);
        if (generation !== this.generation) return;
        if (latest.id !== credential.id || latest.role !== credential.role) throw invalid();
        await this.ensureReport(latest.snapshot, credential);
        if (generation !== this.generation) return;
        this.accept(latest.snapshot, credential.id);
        const response = await this.request(this.endpoint + `/v1/rooms/${credential.id}/events`, { signal, headers: { Authorization: "Bearer " + credential.token }, credentials: "omit", cache: "no-store" });
        await fetchNDJSON(response, signal, value => {
          if (generation !== this.generation || !record(value)) return;
          if (record(value.error)) {
            if (value.error.code === "ROOM_EXPIRED" || value.error.code === "ROOM_NOT_FOUND") throw new RoomRequestError(410);
            if (value.error.code === "UNAUTHORIZED") throw new RoomRequestError(401);
            throw invalid();
          }
          this.accept(value.snapshot, credential.id); attempt = 0; this.update({ connected: true, message: "" });
        });
      } catch (error) {
        if (generation !== this.generation || signal.aborted) return;
        if ((error instanceof RoomRequestError && error.terminal) || error instanceof RoomDataUnavailableError) {
          this.controller.abort(); this.update({ connected: false, sending: false, ended: true, message: error.message }); return;
        }
      }
      if (signal.aborted || generation !== this.generation) return;
      this.update({ connected: false, message: "연결을 다시 확인하고 있습니다. 잠시 기다려 주세요." });
      await new Promise<void>(resolve => { const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); }; const timer = setTimeout(done, Math.min(8000, 500 * 2 ** Math.min(attempt++, 4))); signal.addEventListener("abort", done, { once: true }); });
    }
  }
  async action(kind: "SELECT" | "NEXT_GAME" | "RESET", championId?: string) {
    if (!this.credential || !this.state.connected || this.state.sending || !this.state.snapshot) return;
    const snapshot = this.state.snapshot;
    if (kind === "SELECT" ? snapshot.status !== "DRAFTING" || this.credential.role !== nextDraftTurn(snapshot.selections, snapshot.firstPickSide)?.side || typeof championId !== "string" : this.credential.role !== "BLUE" || (kind === "NEXT_GAME" && snapshot.status !== "COMPLETE")) return;
    const generation = this.generation, credential = this.credential; this.update({ sending: true });
    try {
      const data = await this.http(`/v1/rooms/${credential.id}/actions`, "POST", { id: crypto.randomUUID(), revision: this.state.snapshot.revision, kind, ...(kind === "SELECT" ? { championId } : {}) }, credential);
      if (generation === this.generation) this.accept(data.snapshot, credential.id);
    } catch (error) {
      if (generation === this.generation) {
        if (error instanceof RoomRequestError && error.terminal) { this.controller.abort(); this.update({ connected: false, ended: true }); }
        this.update({ message: error instanceof Error ? error.message : "선택을 반영하지 못했습니다." });
        if (error instanceof RoomRequestError && error.status === 409) {
          try { const latest = await this.http(`/v1/rooms/${credential.id}`, "GET", undefined, credential); if (generation === this.generation) this.accept(latest.snapshot, credential.id); } catch { /* The stream also refreshes current state. */ }
        }
      }
    }
    finally { if (generation === this.generation) this.update({ sending: false }); }
  }
  leave() { this.generation++; this.controller.abort(); this.controller = new AbortController(); this.credential = undefined; this.state = { active: false, connected: false, sending: false }; this.onState(this.state); }
}
