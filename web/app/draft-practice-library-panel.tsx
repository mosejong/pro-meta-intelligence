"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DraftSession } from "./draft-session";
import type { RosterScenario } from "./roster-scenario";
import { createPracticeLibrary, createPracticeLoadGate, entryHasRoster, entryHasSeason, PRACTICE_GATE_TEXT, type PracticeLoadTicket,PRACTICE_LIMIT, PRACTICE_NAME_MAX, practiceErrorText, validatePracticeName, PRACTICE_ERROR_TEXT, type PracticeEntry, type PracticeLibrary } from "./draft-practice-library";
import { verifySeasonPart, type SeasonPracticePart } from "./practice-roster-bundle";
import type { SeasonCardCatalog, TeamSeasonSlots } from "./season-player-cards";
import "./draft-practice-library.css";

const defaultLibrary = createPracticeLibrary();

type Pending = { kind: "LOAD" | "DELETE"; id: string; name: string; ticket: PracticeLoadTicket; roster?: boolean; season?: boolean } | null;
type Status = { tone: "ok" | "error"; text: string } | null;
/** Season part verified against the live catalog it was checked with. */
export type VerifiedPracticeSeason = { catalog: SeasonCardCatalog; lineups: TeamSeasonSlots };
const SEASON_CANCELLED = "불러오기를 취소했습니다. 현재 밴픽과 선수 구성은 그대로 유지합니다.";

/**
 * "내 연습 보관함": collapsed by default. Opening the list never changes the draft.
 * Loading goes through `onLoad` (the caller's existing restore path) only after validation and,
 * when there is work in progress, an explicit confirmation.
 */
export function DraftPracticeLibraryPanel({ scenario, roster = null, season = null, rosterBlocked = null, boardKey: draftBoardKey, hasWork, locked, onLoad, loadSeasonCatalog = null, library = defaultLibrary }: {
  /** Ready current-player roster-scenario v1 text for this exact board, or null. */
  roster?: string | null;
  /** Season-player references verified against the loaded catalog for `roster`, or null. Saved only with the roster. */
  season?: SeasonPracticePart | null;
  /** Loads the currently published season catalog (parsed + integrity-checked). Needed to restore season refs. */
  loadSeasonCatalog?: ((signal: AbortSignal) => Promise<SeasonCardCatalog>) | null;
  /** Why the roster cannot be saved together (e.g. season players assigned), or null. */
  rosterBlocked?: string | null;
  /**
   * Small identity of the current board and context (selections, previous sets, staged champion,
   * matchup, first pick, explicit positions, analysis basis, room/import mode). Any change
   * invalidates pending confirmations and in-flight loads.
   */
  boardKey: string;
  /** Current serialized scenario (with explicit positions), or null when nothing can be saved. */
  scenario: string | null;
  /** Current selections, previous sets or a staged champion exist. */
  hasWork: boolean;
  /** Friend room active, session not ready or another import running. */
  locked: boolean;
  /** Called once, after validation and confirmation, with the draft and its saved roster (or null). */
  onLoad: (session: DraftSession, roster: RosterScenario | null, season: VerifiedPracticeSeason | null) => void;
  library?: PracticeLibrary;
}) {
  // Explicit choice; defaults to on only while a safely prepared roster exists.
  const [includePref, setIncludePref] = useState<boolean | null>(null);
  const includeRoster = roster !== null && (includePref ?? true);
  const includeSeason = includeRoster && season !== null;
  // Roster/season edits and the checkbox are part of the gate: they invalidate pending/in-flight loads.
  const boardKey = JSON.stringify([draftBoardKey, roster, season, includeRoster]);
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<PracticeEntry[] | null>(null);
  const [damaged, setDamaged] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [pendingState, setPending] = useState<Pending>(null);
  // Render-time adjustment: any lock transition clears every confirmation (it cannot revive on
  // unlock); a board change clears a load confirmation. The gate below re-checks on confirm too.
  const [seen, setSeen] = useState({ boardKey, locked });
  if (seen.boardKey !== boardKey || seen.locked !== locked) {
    setSeen({ boardKey, locked });
    if (pendingState && (seen.locked !== locked || pendingState.kind === "LOAD")) setPending(null);
  }
  const pending = locked ? null : pendingState;
  const generation = useRef(0);
  const gate = useRef<ReturnType<typeof createPracticeLoadGate> | null>(null);
  if (gate.current === null) gate.current = createPracticeLoadGate();
  // Latest callback without making its identity part of any gating.
  const onLoadRef = useRef(onLoad);
  const loaderRef = useRef(loadSeasonCatalog);
  // In-flight season catalog request (if any); aborted on board/lock change, cancel or unmount.
  const seasonAbort = useRef<AbortController | null>(null);
  const [seasonLoading, setSeasonLoading] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => { onLoadRef.current = onLoad; loaderRef.current = loadSeasonCatalog; }, [onLoad, loadSeasonCatalog]);
  useLayoutEffect(() => { gate.current!.observe(boardKey, locked); }, [boardKey, locked]);
  // Team/board change or room start stops the fetch; the gate re-check then refuses any late apply.
  useEffect(() => { seasonAbort.current?.abort(); }, [boardKey, locked]);
  useEffect(() => () => { generation.current++; seasonAbort.current?.abort(); }, []);
  useEffect(() => { if (pending) cancelRef.current?.focus(); }, [pending]);
  // Escape cancels the confirmation while focus is inside it. Listener exists only while a
  // confirmation is shown and is scoped to the dialog element.
  const hasPending = pending !== null;
  useEffect(() => {
    if (!hasPending) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      const dialog = confirmRef.current;
      if (event.key !== "Escape" || !dialog || !(event.target instanceof Node) || !dialog.contains(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      setPending(null);
      window.setTimeout(() => returnFocus.current?.focus(), 0);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [hasPending]);

  /** Every async action gets a token; a superseded/unmounted result is ignored. */
  const begin = () => { const token = ++generation.current; setBusy(true); return token; };
  const current = (token: number) => token === generation.current;

  const refresh = useCallback(async (token?: number) => {
    const own = token ?? ++generation.current;
    if (token === undefined) setBusy(true);
    try {
      const result = await library.list();
      if (own !== generation.current) return;
      setEntries(result.entries); setDamaged(result.damaged);
    } catch (error) {
      if (own === generation.current) setStatus({ tone: "error", text: practiceErrorText(error) });
    } finally { if (own === generation.current) setBusy(false); }
  }, [library]);

  useEffect(() => {
    if (!open || entries !== null) return;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [open, entries, refresh]);

  const total = (entries?.length ?? 0) + damaged.length;
  const nameCheck = validatePracticeName(name, entries?.map((entry) => entry.name) ?? []);
  const canSave = !locked && !busy && scenario !== null && entries !== null && total < PRACTICE_LIMIT && nameCheck.ok;

  async function save() {
    if (!canSave || scenario === null) return;
    const token = begin();
    setStatus(null);
    try {
      const entry = await library.save(name, scenario, includeRoster ? roster : null, includeSeason ? season : null);
      if (!current(token)) return;
      setName("");
      // Shown only after the transaction completed.
      setStatus({ tone: "ok", text: `“${entry.name}” 연습을 이 기기에 저장했습니다.${entryHasSeason(entry) ? " 현재 선수 구성과 시즌 선수 선택(자료 버전 포함)도 함께 저장했습니다." : entryHasRoster(entry) ? " 현재 선수 구성도 함께 저장했습니다." : " 선수 구성은 포함하지 않았습니다."}` });
    } catch (error) {
      if (current(token)) setStatus({ tone: "error", text: practiceErrorText(error) });
    }
    if (current(token)) await refresh(token);
  }

  function closeConfirm() {
    setPending(null);
    window.setTimeout(() => returnFocus.current?.focus(), 0);
  }

  /** `ticket` is the board/lock revision the user approved (click without work, or the confirmation). */
  async function load(id: string, ticket: PracticeLoadTicket) {
    if (locked || busy) return;
    const before = gate.current!.check(ticket);
    if (before !== "OK") { setPending(null); setStatus({ tone: "error", text: PRACTICE_GATE_TEXT[before] }); return; }
    const token = begin();
    setPending(null);
    setStatus(null);
    let controller: AbortController | null = null;
    try {
      const { entry, session, roster: savedRoster, season: savedSeason } = await library.read(id);
      if (!current(token)) return;
      // Re-check against the latest committed board/lock: newer work always wins over a late read.
      const mid = gate.current!.check(ticket);
      if (mid !== "OK") { setStatus({ tone: "error", text: PRACTICE_GATE_TEXT[mid] }); return; }
      let verified: VerifiedPracticeSeason | null = null;
      if (savedSeason && savedRoster) {
        // Nothing is applied until the season refs are verified against the live published catalog.
        const loader = loaderRef.current;
        if (!loader) { setStatus({ tone: "error", text: "시즌 선수 자료를 불러올 수 없어 연습을 불러오지 않았습니다. 현재 밴픽과 선수 구성은 그대로 유지합니다." }); return; }
        controller = new AbortController();
        seasonAbort.current = controller;
        setSeasonLoading(true);
        setStatus({ tone: "ok", text: "시즌 선수 자료를 확인하는 중입니다. 확인이 끝나기 전에는 아무것도 바꾸지 않습니다." });
        let catalog: SeasonCardCatalog | null = null;
        try { catalog = await loader(controller.signal); } catch { catalog = null; }
        if (!current(token)) return;
        const afterCatalog = gate.current!.check(ticket);
        if (afterCatalog !== "OK") { setStatus({ tone: "error", text: PRACTICE_GATE_TEXT[afterCatalog] }); return; }
        if (controller.signal.aborted) { setStatus({ tone: "error", text: SEASON_CANCELLED }); return; }
        const checked = verifySeasonPart(savedSeason, savedRoster, catalog);
        if (!checked.ok || !catalog) { setStatus({ tone: "error", text: checked.ok ? "시즌 선수 자료를 확인하지 못했습니다. 현재 밴픽과 선수 구성은 그대로 유지합니다." : checked.message }); return; }
        verified = { catalog, lineups: checked.lineups };
      }
      const after = gate.current!.check(ticket);
      if (after !== "OK") { setStatus({ tone: "error", text: PRACTICE_GATE_TEXT[after] }); return; }
      // One explicit restore: draft + current roster + verified season refs together.
      onLoadRef.current(session, savedRoster, verified);
      setStatus({ tone: "ok", text: `“${entry.name}” 연습을 불러왔습니다. 저장 당시의 분석 기준을 그대로 사용합니다.${verified ? " 함께 저장한 현재 선수·시즌 선수 구성도 복원합니다. 시즌 기록은 당시 관측이며 능력치나 승률이 아닙니다." : savedRoster ? " 함께 저장한 선수 구성도 복원합니다." : " 이 연습에는 선수 구성이 포함되어 있지 않아 현재 로스터를 유지합니다."}` });
    } catch (error) {
      if (current(token)) setStatus({ tone: "error", text: practiceErrorText(error) });
    } finally {
      if (controller && seasonAbort.current === controller) seasonAbort.current = null;
      if (current(token)) { setBusy(false); setSeasonLoading(false); }
    }
  }

  /** User cancel while the season catalog is being checked; the load ends without applying anything. */
  function cancelSeasonLoad() { seasonAbort.current?.abort(); }

  function requestLoad(entry: PracticeEntry, trigger: HTMLElement) {
    if (locked || busy) return;
    const ticket = gate.current!.ticket();
    if (!hasWork) { void load(entry.id, ticket); return; }
    returnFocus.current = trigger;
    setPending({ kind: "LOAD", id: entry.id, name: entry.name, ticket, roster: entryHasRoster(entry), season: entryHasSeason(entry) });
  }

  function requestDelete(id: string, label: string, trigger: HTMLElement) {
    if (locked || busy) return;
    returnFocus.current = trigger;
    setPending({ kind: "DELETE", id, name: label, ticket: gate.current!.ticket() });
  }

  async function remove(id: string) {
    if (locked || busy) return;
    const token = begin();
    setPending(null);
    setStatus(null);
    try {
      await library.remove(id);
      if (current(token)) setStatus({ tone: "ok", text: "보관함에서 삭제했습니다." });
    } catch (error) {
      if (current(token)) setStatus({ tone: "error", text: practiceErrorText(error) });
    }
    if (current(token)) await refresh(token);
  }

  const hint = locked ? "친구 방 사용 중에는 보관함을 쓸 수 없습니다."
    : scenario === null ? "저장할 밴픽이 아직 없습니다."
      : entries !== null && total >= PRACTICE_LIMIT ? PRACTICE_ERROR_TEXT.LIMIT
        : name && !nameCheck.ok ? PRACTICE_ERROR_TEXT[nameCheck.code] : "";

  return <details className="draft-practice-library" lang="ko" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>내 연습 보관함{entries !== null ? ` · ${total}/${PRACTICE_LIMIT}` : ""}</summary>
    <p className="draft-practice-note">이 기기에만 최대 {PRACTICE_LIMIT}개 보관합니다. 밴픽·이전 세트·직접 배정한 포지션은 저장되고, 선택하면 현재 공개 스냅샷 선수로 짠 가상 로스터와 배정한 시즌 선수(자료 버전·카드 식별자만)도 함께 저장됩니다. 시즌 선수는 불러올 때 현재 공개 시즌 자료와 같은 버전일 때만 복원됩니다. 감독/코치·가정 실험·기준 A는 저장되지 않습니다.</p>
    <form className="draft-practice-save" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label htmlFor="draft-practice-name">연습 이름</label>
      <div>
        <input id="draft-practice-name" value={name} onChange={(event) => setName(event.currentTarget.value)} disabled={locked}
          autoComplete="off" placeholder={`${PRACTICE_NAME_MAX}자 이내`} aria-invalid={Boolean(name) && !nameCheck.ok} aria-describedby="draft-practice-hint" />
        <button type="submit" disabled={!canSave}>이 연습 저장</button>
      </div>
      <label><input type="checkbox" checked={includeRoster} disabled={locked || busy || roster === null} onChange={(event) => setIncludePref(event.currentTarget.checked)} aria-describedby="draft-practice-roster-hint" /> 현재 선수 구성도 함께 저장</label>
      <small id="draft-practice-roster-hint">{roster === null ? (rosterBlocked ?? "선수 구성이 아직 준비되지 않아 밴픽만 저장합니다.") : includeSeason ? "현재 가상 로스터와 시즌 선수 선택을 밴픽과 함께 저장합니다." : includeRoster ? "현재 가상 로스터를 밴픽과 함께 저장합니다." : "밴픽만 저장합니다."}</small>
      <small id="draft-practice-hint">{hint}</small>
    </form>
    {status && <p role={status.tone === "error" ? "alert" : "status"} className={`draft-practice-status ${status.tone}`}>{status.text}</p>}
    {seasonLoading && <button type="button" className="draft-practice-refresh" onClick={cancelSeasonLoad}>불러오기 취소</button>}
    {pending && <div className="draft-practice-confirm" role="alertdialog" aria-labelledby="draft-practice-confirm-text" ref={confirmRef}>
      <p id="draft-practice-confirm-text">{pending.kind === "LOAD"
        ? `진행 중인 밴픽을 “${pending.name}” 연습으로 바꿀까요? 현재 화면의 밴픽은 이 연습으로 대체됩니다.${pending.season ? " 현재 가상 로스터와 시즌 선수 배정도 저장된 구성으로 바뀝니다. 시즌 자료를 먼저 확인하며, 확인하지 못하면 아무것도 바꾸지 않습니다." : pending.roster ? " 현재 가상 로스터도 저장된 선수 구성으로 바뀝니다." : ""}`
        : `“${pending.name}” 연습을 삭제할까요? 되돌릴 수 없습니다.`}</p>
      <div>
        <button type="button" onClick={() => pending.kind === "LOAD" ? void load(pending.id, pending.ticket) : void remove(pending.id)} disabled={busy || locked}>{pending.kind === "LOAD" ? "바꾸기" : "삭제"}</button>
        <button type="button" ref={cancelRef} onClick={closeConfirm}>취소</button>
      </div>
    </div>}
    {entries === null ? (open && <p className="draft-practice-empty">{status?.tone === "error" && !busy ? "목록을 열 수 없습니다." : "목록을 확인하는 중…"}</p>)
      : <ul className="draft-practice-list" aria-busy={busy}>
        {entries.length === 0 && damaged.length === 0 && <li className="draft-practice-empty">저장한 연습이 없습니다.</li>}
        {entries.map((entry) => <li key={entry.id}>
          <div className="draft-practice-meta">
            <b>{entry.name}</b>
            <small>{new Date(entry.created_at).toLocaleString("ko-KR")} · 패치 {entry.summary.patch_id} · {entry.summary.game_number}세트 {entry.summary.selections}/20{entry.summary.positions ? " · 포지션 포함" : ""}{entryHasSeason(entry) ? " · 선수 구성·시즌 선수 포함" : entryHasRoster(entry) ? " · 선수 구성 포함" : ""}</small>
          </div>
          <div className="draft-practice-actions">
            <button type="button" onClick={(event) => requestLoad(entry, event.currentTarget)} disabled={locked || busy} aria-label={`${entry.name} 열기`}>열기</button>
            <button type="button" onClick={(event) => requestDelete(entry.id, entry.name, event.currentTarget)} disabled={locked || busy} aria-label={`${entry.name} 삭제`}>삭제</button>
          </div>
        </li>)}
        {damaged.map((id, index) => <li key={`damaged-${id || index}`} className="damaged">
          <div className="draft-practice-meta"><b>손상되었거나 지원하지 않는 항목</b><small>열 수 없습니다. 삭제하면 자리가 비워집니다.</small></div>
          <div className="draft-practice-actions">
            {id && <button type="button" onClick={(event) => requestDelete(id, "손상된 항목", event.currentTarget)} disabled={locked || busy}>삭제</button>}
          </div>
        </li>)}
      </ul>}
    {open && <button type="button" className="draft-practice-refresh" onClick={() => void refresh()} disabled={busy}>목록 새로고침</button>}
  </details>;
}
