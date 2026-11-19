"use client";

/* eslint-disable @next/next/no-img-element -- champion portraits use Riot Data Dragon */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { championAssetId, championImageUrl } from "./champion-assets";
import { useChampionNames } from "./champion-names";
import {
  applyDraftSelection,
  buildDraftAgentFrame,
  completeFearlessGame,
  fearlessLocks,
  previewOpponentPick,
  DRAFT_MODEL_VERSION,
  isChampionLocked,
  nextDraftTurn,
  serializeDraftScenario,
  draftSequence,
  STANDARD_DRAFT_SEQUENCE,
  type DraftActionKind,
  type DraftAgentOption,
  type DraftSelection,
  type DraftSide,
  type DraftGame,
} from "./draft-agent";
import { productRootHref, productSpaceHref, type ProductSpace } from "./product-space";
import { isDraftSessionErrorCode, MAX_DRAFT_FILE_BYTES, parseDraftSession, readLocalDraft, type DraftSession, type DraftSessionErrorCode } from "./draft-session";
import { useDraftSave } from "./use-draft-save";
import type { OpponentTeam, RadarReport } from "./radar-types";
import { TeamChooser } from "./team-chooser";
import { defaultDraftMatchup } from "./team-defaults";
import { DraftChampionInfo, type ChampionFocus } from "./draft-champion-info";
import { DraftComparisonPanel } from "./draft-comparison-panel";
import { PartnershipPlacement } from "./partnership-placement";
import { RosterWorkshop, type RosterMeta, type RosterRestoreRequest } from "./roster-workshop";
import { SimulationReadinessPanel } from "./simulation-readiness-panel";
import { ExperimentReplayPanel } from "./experiment-replay-panel";
import type { LiveRoster } from "./roster-comparison";
import type { SimulationInputSnapshot } from "./simulation-scenario";
import { DEFAULT_LOCALE, LanguageSelector, useLocale, type Locale, type MessageKey } from "./locale";
import "./draft-workspace.css";
import "./draft-studio.css";
import { WorkspaceHeader } from "./workspace-header";
import { DraftSharePanel } from "./draft-share-panel";
import { DraftRoomPanel, type RoomControls } from "./draft-room-panel";
import { useSoloSeasonHistory } from "./use-solo-season-history";
import { explainSoloDraftTurn, suggestSoloDraftTurn } from "./solo-draft";
import { SoloDraftHistoryPanel } from "./solo-draft-history-panel";
import { appendSoloAutoHistory, pruneSoloAutoHistory, soloHistoryContext, type SoloAutoHistory } from "./solo-draft-history";
import { SoloDraftExplanationPanel, soloAutoContext, soloAutoRecordMatches, type SoloAutoRecord } from "./solo-draft-explanation";
import { DraftPositionStack } from "./draft-position-stack";
import { emptyChampionRoles, championKey, teamPicks, type ChampionRoles, type RoleAssignments } from "./champion-roles";
import { buildDraftPositionBoard, reconcileChampionRoles, moveChampionRole } from "./draft-position-board";
import { normalizeDraftPositions } from "./draft-position-session";
import { DraftPracticeLibraryPanel } from "./draft-practice-library-panel";
import { loadPublishedSeasonCatalog } from "./season-catalog-loader";
import { basisKey, buildRosterIndex, pairKey, rosterBasis, serializeRosterScenario, type RosterRole } from "./roster-scenario";
import { DraftResultPanel } from "./draft-result-panel";
import { DraftSeriesRecapPanel } from "./draft-series-recap-panel";

type DraftLabProps = {
  currentSpace: ProductSpace;
  report: RadarReport;
  feedLabel: string;
};

const laneLabels: Record<DraftAgentOption["lane"], string> = {
  SAFE: "안전안",
  PRESSURE: "압박안",
  EXPERIMENT: "실험안",
};

type StudioTab = "DRAFT" | "ROSTER" | "DETAILS" | "COMPARISON" | "SIMULATION";
const studioTabs: Array<{ id: StudioTab; label: MessageKey; panel: string }> = [
  { id: "DRAFT", label: "draft.tab.DRAFT", panel: "studio-panel-draft" },
  { id: "ROSTER", label: "draft.tab.ROSTER", panel: "studio-panel-roster" },
  { id: "DETAILS", label: "draft.tab.DETAILS", panel: "studio-panel-details" },
  { id: "COMPARISON", label: "draft.tab.COMPARISON", panel: "studio-panel-comparison" },
  { id: "SIMULATION", label: "draft.tab.SIMULATION", panel: "studio-panel-simulation" },
];
const panelOf = (tab: StudioTab) => studioTabs.find((item) => item.id === tab)!.panel;

// The rail is vertical beside the panels from this width and a horizontal strip above them below it.
const RAIL_QUERY = "(min-width: 1100px)";
function subscribeRail(onChange: () => void) {
  const query = window.matchMedia?.(RAIL_QUERY);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}
const verticalRail = () => Boolean(window.matchMedia?.(RAIL_QUERY).matches);

const roleLabels: Record<string, string> = {
  TOP: "탑",
  JUNGLE: "정글",
  MID: "미드",
  BOTTOM: "바텀",
  SUPPORT: "서포터",
};

// Session statuses are kept as stable codes (+ params) and rendered per locale at render time,
// so switching language re-translates them instead of freezing old-language strings in state.
type SessionErrorReason = { code: DraftSessionErrorCode | null; text: string };
type StorageStatus =
  | { code: "CHECKING" | "RESTORED" | "IDLE" | "UNAVAILABLE" | "SAVING" | "SAVED" | "SAVE_FAILED" }
  | { code: "RESTORE_FAILED"; reason: SessionErrorReason };
type ImportStatus =
  | { code: "TOO_LARGE" | "LOADED" | "READ_FAILED" }
  | { code: "PARSE_FAILED"; reason: SessionErrorReason };

// Key builders kept outside components; each return is checked against the dictionary keys.
const sideKey = (side: DraftSide): MessageKey => `draft.side.${side}`;
const sessionErrorKey = (code: DraftSessionErrorCode): MessageKey => `session.error.${code}`;
const storageKey = (code: Exclude<StorageStatus["code"], "RESTORE_FAILED">): MessageKey => `draft.storage.${code}`;
const importKey = (code: "LOADED" | "READ_FAILED"): MessageKey => `draft.import.${code}`;
const phaseKey = (kind: DraftActionKind) => kind === "BAN" ? "draft.phase.BAN" as const : "draft.phase.PICK" as const;
const turnHintKey = (kind: DraftActionKind) => kind === "BAN" ? "draft.turnHint.BAN" as const : "draft.turnHint.PICK" as const;

/** An unknown code keeps the parser's original (Korean) text; it is never treated as success. */
function sessionReason(result: { error: string; code?: unknown }): SessionErrorReason {
  return { code: isDraftSessionErrorCode(result.code) ? result.code : null, text: result.error };
}

function untranslatedReason(status: StorageStatus | ImportStatus | null) {
  return Boolean(status && (status.code === "RESTORE_FAILED" || status.code === "PARSE_FAILED") && !status.reason.code);
}

/**
 * The draft studio <main> stays lang="ko" because the details tab and champion-info panel
 * are still Korean. Translated controls get `lang` only when it differs from Korean, so the
 * Korean markup is unchanged. Champion display names come from the ko_KR catalog and are
 * marked lang="ko" inside translated controls.
 */
function langAttrs(locale: Locale) {
  const ui = locale === DEFAULT_LOCALE ? undefined : locale;
  return { ui, name: ui ? DEFAULT_LOCALE : undefined };
}

function scrollIntoViewGently(element: Element | null, block: ScrollLogicalPosition = "start") {
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  element?.scrollIntoView({ block, behavior: reduceMotion ? "instant" : "smooth" });
}

function selectionsFor(selections: DraftSelection[], side: DraftSide, kind: DraftActionKind) {
  return selections.filter((selection) => selection.side === side && selection.kind === kind).sort((left, right) => left.slot - right.slot);
}

type InspectedSlot = Pick<DraftSelection, "side" | "kind" | "slot" | "champion_id">;

const sameSlot = (left: Pick<DraftSelection, "side" | "kind" | "slot">, right: Pick<DraftSelection, "side" | "kind" | "slot">) =>
  left.side === right.side && left.kind === right.kind && left.slot === right.slot;

/** Read-only affordance for a confirmed slot: opens its champion info, never edits the draft. */
function inspectProps(selection: DraftSelection, inspected: InspectedSlot | null, label: string, onInspect: (slot: InspectedSlot) => void) {
  const open = () => onInspect({ side: selection.side, kind: selection.kind, slot: selection.slot, champion_id: selection.champion_id });
  return {
    role: "button" as const,
    tabIndex: 0,
    "aria-pressed": Boolean(inspected && sameSlot(inspected, selection) && inspected.champion_id === selection.champion_id),
    "aria-label": label,
    onClick: open,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      open();
    },
  };
}

function TeamDraftColumn({
  side,
  team,
  selections,
  active,
  staged,
  nameOf,
  inspected,
  onInspect, assignments, unassigned, positionDisabled, onAssign, onConfirm,
}: {
  assignments: ChampionRoles;
  unassigned: string[];
  positionDisabled: boolean;
  onAssign: (id: string, role: RosterRole | null) => void;
  onConfirm: () => void;
  side: DraftSide;
  team: OpponentTeam | null;
  selections: DraftSelection[];
  active: boolean;
  staged: DraftSelection | null;
  nameOf: (championId: string) => string;
  inspected: InspectedSlot | null;
  onInspect: (slot: InspectedSlot) => void;
}) {
  const bans = selectionsFor(selections, side, "BAN");
  const { locale, t, format } = useLocale();
  const lang = langAttrs(locale);
  const sideLabel = t(sideKey(side));
  return <section className={`draft-team-column ${side.toLowerCase()} ${active ? "active" : ""}`} aria-label={format("draft.column.label", { side })} lang={lang.ui}>
    <header><span>{side} SIDE</span><h2>{team?.team_name ?? t("draft.column.noTeam")}</h2><small>{team ? format("draft.column.sample", { count: team.game_count, leagues: team.leagues.join("/") }) : t("draft.column.noEvidence")}</small></header>
    <div className="draft-ban-row" aria-label={format("draft.column.bans", { side })}>
      {Array.from({ length: 5 }, (_, index) => {
        const preview = staged?.side === side && staged.kind === "BAN" && staged.slot === index + 1 ? staged : null;
        const confirmed = bans.find((item) => item.slot === index + 1) ?? null;
        const selection = confirmed ?? preview;
        return <div className={preview ? "staged" : selection ? "filled" : ""} key={index}
          title={selection ? (preview ? format("draft.column.stagedTitle", { name: nameOf(selection.champion_id) }) : nameOf(selection.champion_id)) : format("draft.column.banSlot", { slot: index + 1 })}
          {...(confirmed ? inspectProps(confirmed, inspected, format("draft.inspect.BAN", { side: sideLabel, slot: index + 1, name: nameOf(confirmed.champion_id) }), onInspect) : {})}>
          {selection ? <img src={championImageUrl(selection.champion_id)} alt={nameOf(selection.champion_id)} lang={lang.name} /> : <span>×</span>}<b>B{index + 1}</b>
        </div>;
      })}
    </div>
    <DraftPositionStack team={team} side={side} selections={selections} staged={staged} assignments={assignments} unassigned={unassigned} disabled={positionDisabled} nameOf={nameOf} onAssign={onAssign} onConfirm={onConfirm} onInspect={onInspect} inspected={selections.find(item => inspected && sameSlot(item, inspected) && item.champion_id === inspected.champion_id) ?? null} />
  </section>;
}

/** Position work is valid only for this exact basis, matchup, first-pick side, series and room mode. */
function positionContextKey(report: RadarReport, blueTeamId: string, redTeamId: string, firstPickSide: DraftSide, games: DraftGame[], roomActive: boolean) {
  return JSON.stringify([basisKey(rosterBasis(report)), blueTeamId, redTeamId, firstPickSide, games, roomActive]);
}

export function DraftLab({ currentSpace, report: liveReport, feedLabel }: DraftLabProps) {
  const [room, setRoom] = useState<RoomControls>({ active: false, connected: false, sending: false, action: () => {} });
  const [seriesReport, setSeriesReport] = useState<RadarReport | null>(null);
  const report = seriesReport ?? liveReport;
  const [games, setGames] = useState<DraftGame[]>([]);
  const previousPicks = useMemo(() => fearlessLocks(games), [games]);
  const { catalog, matches, nameOf } = useChampionNames();
  const { locale, t, format } = useLocale();
  const lang = langAttrs(locale);
  const teams = useMemo(() => report.opponent_prep?.teams ?? [], [report.opponent_prep?.teams]);
  // Team-neutral default (largest public sample, then name/ID); saved or user selections replace it.
  const defaultMatchup = useMemo(() => defaultDraftMatchup(teams), [teams]);
  const [blueTeamId, setBlueTeamId] = useState(defaultMatchup.blue?.team_id ?? "");
  const [redTeamId, setRedTeamId] = useState(defaultMatchup.red?.team_id ?? "");
  const [positionState, setPositionState] = useState<{ context: string; roles: RoleAssignments; unassigned?: Record<string, string[]> }>({ context: "", roles: {} });
  const [selections, setSelections] = useState<DraftSelection[]>([]);
  const [firstPickSide, setFirstPickSide] = useState<DraftSide>("BLUE");
  const [query, setQuery] = useState("");
  const [availableOnly, setAvailableOnly] = useState(true);
  const [pendingReset, setPendingReset] = useState<"GAME" | "SERIES" | null>(null);
  const resetDialog = useRef<HTMLDialogElement>(null);
  const cancelReset = useRef<HTMLButtonElement>(null);
  const [pendingChampion, setPendingChampion] = useState<string | null>(null);
  const [timer, setTimer] = useState(30);
  const [timerRunning, setTimerRunning] = useState(false);
  const [soloEnabled, setSoloEnabled] = useState(false);
  const [manualSide, setManualSide] = useState<DraftSide>("BLUE");
  const [lastAuto, setLastAuto] = useState<SoloAutoRecord | null>(null);
  // Memory-only review of every real auto turn in the current set (frozen pre-choice records).
  const [autoHistory, setAutoHistory] = useState<SoloAutoHistory>([]);
  const [sessionReady, setSessionReady] = useState(false);
  const [importing, setImporting] = useState(false);
  const [storageStatus, setStorageStatus] = useState<StorageStatus>({ code: "CHECKING" });
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);
  // All five panels stay mounted; switching only sets `hidden`, so draft, timer, roster, baseline A,
  // role assignments, frozen input and file-replay state all survive a round trip through the rail.
  const [studioTab, setStudioTab] = useState<StudioTab>("DRAFT");
  const studioTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const studioRail = useRef<HTMLDivElement>(null);
  const studioShell = useRef<HTMLDivElement>(null);
  const railVertical = useSyncExternalStore(subscribeRail, verticalRail, () => false);
  // Read-only viewing of an already-confirmed slot. Separate from pendingChampion: it never stages or confirms.
  const [inspected, setInspected] = useState<InspectedSlot | null>(null);
  // Remount key for the A/B comparison panel; its memory-only baseline A is dropped on import/restore.
  const [comparisonEpoch, setComparisonEpoch] = useState(0);
  // Live virtual roster published by the roster editor (tagged with its basis and pair); null until restored.
  const [liveRoster, setLiveRoster] = useState<LiveRoster | null>(null);
  // Season-player presence reported by the roster editor (null while none is mounted).
  const [rosterMeta, setRosterMeta] = useState<RosterMeta | null>(null);
  // Explicit roster restore from the practice library (token + validated payload).
  const [rosterRequest, setRosterRequest] = useState<RosterRestoreRequest | null>(null);
  const rosterToken = useRef(0);
  /** Current ready simulation input (with explicit roles) reported by the readiness panel, or null. */
  const [readyInput, setReadyInput] = useState<SimulationInputSnapshot | null>(null);
  // Past-season players: practice/saving/observation only, never assumption-experiment input.
  const historicalPlayers = rosterMeta?.seasonPlayers ?? false;
  const experimentReadyInput = historicalPlayers ? null : readyInput;
  const blueTeam = teams.find((team) => team.team_id === blueTeamId) ?? null;
  const redTeam = teams.find((team) => team.team_id === redTeamId) ?? null;
  const positionContext = positionContextKey(report, blueTeamId, redTeamId, firstPickSide, games, room.active);
  const positionUnassigned = positionState.context === positionContext ? positionState.unassigned ?? {} : {};
  const positionRoles: RoleAssignments = {};
  for (const [side, team] of [["BLUE", blueTeam], ["RED", redTeam]] as const) if (team) positionRoles[team.team_id] = reconcileChampionRoles(positionState.context === positionContext ? positionState.roles[team.team_id] ?? emptyChampionRoles() : emptyChampionRoles(), teamPicks(selections, side));
  function assignPosition(side: DraftSide, id: string, role: RosterRole | null) {
    const team = side === "BLUE" ? blueTeam : redTeam;
    if (!team || room.active || !sessionReady || importing) return;
    setPositionState(current => ({ context: positionContext, unassigned: { ...(current.context === positionContext ? current.unassigned : {}), [team.team_id]: [...(current.context === positionContext ? current.unassigned?.[team.team_id] ?? [] : []).filter(value => championKey(value) !== championKey(id)), ...(role === null ? [id] : [])] }, roles: { ...(current.context === positionContext ? current.roles : {}), [team.team_id]: moveChampionRole(current.context === positionContext ? current.roles[team.team_id] ?? emptyChampionRoles() : emptyChampionRoles(), id, role, teamPicks(selections, side)) } }));
  }
  function confirmPositions(side: DraftSide) {
    const team = side === "BLUE" ? blueTeam : redTeam;
    if (!team || room.active || !sessionReady || importing) return;
    const board = buildDraftPositionBoard({ team, side, selections, assignments: positionRoles[team.team_id], unassigned: positionUnassigned[team.team_id] });
    if (!board.canConfirm) return;
    const roles = emptyChampionRoles();
    for (const position of board.positions) roles[position.role] = position.champion_id;
    setPositionState(current => ({ context: positionContext, unassigned: current.context === positionContext ? current.unassigned : {}, roles: { ...(current.context === positionContext ? current.roles : {}), [team.team_id]: roles } }));
  }
  const turn = nextDraftTurn(selections, firstPickSide);
  const frame = useMemo(
    () => buildDraftAgentFrame(report, blueTeam, redTeam, selections, previousPicks, firstPickSide),
    [blueTeam, redTeam, report, selections, previousPicks, firstPickSide],
  );
  const preview = useMemo(() => previewOpponentPick(report, blueTeam, redTeam, selections, pendingChampion, previousPicks, 3, firstPickSide),
    [report, blueTeam, redTeam, selections, pendingChampion, previousPicks, firstPickSide]);
  const canSelect = sessionReady && !importing && Boolean(blueTeam && redTeam) && (Boolean(seriesReport) || feedLabel !== "FEED CONNECTING");
  const soloWaiting = soloEnabled && !room.active && !!turn && turn.side !== manualSide;
  const roomCanAct = (!room.active || Boolean(room.connected && !room.sending && room.snapshot?.status === "DRAFTING" && room.role === turn?.side)) && !soloWaiting;
  const roomHostReady = Boolean(room.role === "BLUE" && room.connected && !room.sending);
  const hasCurrentWork = selections.length > 0 || Boolean(pendingChampion);
  // Only a finished current set joins the recap; its team IDs are the board's at completion.
  const recapCurrent = useMemo<DraftGame | null>(() => selections.length === 20 ? { blue_team_id: blueTeamId, red_team_id: redTeamId, selections } : null,
    [selections, blueTeamId, redTeamId]);

  const soloSeason = useSoloSeasonHistory(report, productRootHref(currentSpace), (soloEnabled || studioTab === "DETAILS") && !room.active);
  const autoChoice = useMemo(() => soloEnabled && !room.active && !soloSeason.loading ? suggestSoloDraftTurn({ report, blueTeam, redTeam, selections, previousPicks, firstPickSide, manualSide, seasonHistory: soloSeason.history }) : null,
    [soloEnabled, room.active, report, blueTeam, redTeam, selections, previousPicks, firstPickSide, manualSide, soloSeason.loading, soloSeason.history]);
  useEffect(() => {
    if (!autoChoice || !canSelect || pendingReset || studioTab !== "DRAFT" || room.active) return;
    const timerId = window.setTimeout(() => {
      setSeriesReport(current => current ?? structuredClone(report));
      setSelections(current => current === selections ? applyDraftSelection(current, autoChoice.champion_id, previousPicks, firstPickSide) : current);
      setPendingChampion(null); setInspected(null); setTimer(30); setTimerRunning(false);
      // Explanation is computed once per real auto choice from the same pre-choice input, never per render.
      const explained = explainSoloDraftTurn({ report, blueTeam, redTeam, selections, previousPicks, firstPickSide, manualSide, seasonHistory: soloSeason.history });
      const record: SoloAutoRecord = { turn: selections.length + 1, champion_id: autoChoice.champion_id, reason: autoChoice.reason,
        prefix: selections.map(s => s.champion_id), context: soloAutoContext(blueTeam?.team_id, redTeam?.team_id, firstPickSide, manualSide, previousPicks),
        explanation: explained?.selected.champion_id === autoChoice.champion_id && explained.turn === selections.length + 1 ? explained : null };
      setLastAuto(record);
      // Same record, frozen, keyed additionally by the data basis it was explained against.
      setAutoHistory(current => appendSoloAutoHistory(current, { ...record, context: soloHistoryContext(record.context, basisKey(rosterBasis(report))) }));
    }, 600);
    return () => window.clearTimeout(timerId);
  }, [autoChoice, canSelect, pendingReset, studioTab, room.active, report, selections, previousPicks, firstPickSide, blueTeam, redTeam, manualSide, soloSeason.history]);
  const autoContext = useMemo(() => soloAutoContext(blueTeam?.team_id, redTeam?.team_id, firstPickSide, manualSide, previousPicks),
    [blueTeam?.team_id, redTeam?.team_id, firstPickSide, manualSide, previousPicks]);
  const reportBasis = useMemo(() => basisKey(rosterBasis(report)), [report]);
  const historyContext = soloHistoryContext(autoContext, reportBasis);
  // Adjust-during-render: entries no longer on the board (undo/reselect/reset/team/side/first pick/
  // next set/basis change, room mode or a lost race) are dropped for good, so a later manual choice of
  // the same champion on the same turn is never shown as automatic. Same for the last-choice record.
  const prunedHistory = room.active ? [] : pruneSoloAutoHistory(autoHistory, selections, historyContext);
  if (prunedHistory !== autoHistory && (prunedHistory.length || autoHistory.length)) setAutoHistory(prunedHistory);
  if (lastAuto && !soloAutoRecordMatches(lastAuto, selections, autoContext)) setLastAuto(null);
  useEffect(() => {
    const pause = () => setSoloEnabled(false);
    window.addEventListener("hashchange", pause);
    return () => window.removeEventListener("hashchange", pause);
  }, []);

  useEffect(() => {
    if (pendingReset) { resetDialog.current?.showModal(); cancelReset.current?.focus(); }
    else resetDialog.current?.close();
  }, [pendingReset]);

  const restoreSession = useCallback((session: DraftSession) => {
    setSoloEnabled(false); setLastAuto(null); setAutoHistory([]);
    // Any other restore path drops a not-yet-applied practice roster request.
    setRosterRequest(null);
    // Saved explicit roles/unassigned picks (v4) come back for this exact local context; suggestions are never stored.
    const saved = Object.entries(session.positions ?? {});
    setPositionState(saved.length ? {
      context: positionContextKey(session.report, session.blueTeamId, session.redTeamId, session.firstPickSide, session.games, false),
      roles: Object.fromEntries(saved.map(([id, team]) => [id, { ...team.roles }])),
      unassigned: Object.fromEntries(saved.map(([id, team]) => [id, [...team.unassigned]])),
    } : { context: "", roles: {} });
    setSeriesReport(session.report);
    setBlueTeamId(session.blueTeamId);
    setRedTeamId(session.redTeamId);
    setGames(session.games);
    setSelections(session.selections);
    setFirstPickSide(session.firstPickSide);
    setPendingChampion(session.stagedChampion);
    setInspected(null);
    setQuery("");
    setTimer(30);
    setTimerRunning(false);
    // State setters are stable; listed because the React Compiler infers them here.
  }, [setPendingChampion, setInspected, setQuery]);

  useEffect(() => {
    let active = true;
    readLocalDraft().then((saved) => {
      if (!active) return;
      if (saved) {
        const result = parseDraftSession(saved);
        if (result.ok) {
          setComparisonEpoch((epoch) => epoch + 1);
          restoreSession(result.session);
          setStorageStatus({ code: "RESTORED" });
        } else setStorageStatus({ code: "RESTORE_FAILED", reason: sessionReason(result) });
      } else setStorageStatus({ code: "IDLE" });
    }).catch(() => {
      if (active) setStorageStatus({ code: "UNAVAILABLE" });
    }).finally(() => { if (active) setSessionReady(true); });
    return () => { active = false; };
  }, [restoreSession]);

  // Explicit local position work only (memoized; never part of share links or room messages).
  const positionRecord = useMemo(() => {
    if (room.active || positionState.context !== positionContext) return null;
    return normalizeDraftPositions(positionState.roles, positionState.unassigned ?? {}, { blueTeamId, redTeamId, selections });
  }, [room.active, positionState, positionContext, blueTeamId, redTeamId, selections]);
  const saveSnapshot = useMemo(() => {
    if (!sessionReady || !seriesReport || !blueTeam || !redTeam || importing || room.active) return null;
    return serializeDraftScenario(seriesReport, blueTeam, redTeam, selections, games, pendingChampion, firstPickSide, positionRecord);
  }, [sessionReady, seriesReport, blueTeam, redTeam, selections, games, pendingChampion, importing, firstPickSide, room.active, positionRecord]);
  // Current-player roster for the practice library: only when the editor's live roster belongs to this
  // exact frozen basis and pair. Season players are never saved as current players: they travel as
  // separate catalog references, and only when every reference still resolves in the loaded catalog.
  const practiceRoster = useMemo(() => {
    if (!saveSnapshot || !seriesReport || !liveRoster || !rosterMeta || (rosterMeta.seasonPlayers && !rosterMeta.season)) return null;
    const teamIds = [blueTeamId, redTeamId].sort() as [string, string];
    if (basisKey(liveRoster.basis) !== basisKey(rosterBasis(seriesReport)) || pairKey(liveRoster.teamIds) !== pairKey(teamIds)) return null;
    if (rosterMeta.season && pairKey(Object.keys(rosterMeta.season.lineups)) !== pairKey(teamIds)) return null;
    return serializeRosterScenario({ basis: liveRoster.basis, team_ids: teamIds, rosters: liveRoster.rosters }, buildRosterIndex(seriesReport.opponent_prep?.teams ?? []));
  }, [saveSnapshot, seriesReport, liveRoster, rosterMeta, blueTeamId, redTeamId]);
  const practiceSeason = practiceRoster !== null ? rosterMeta?.season ?? null : null;
  const practiceRosterBlocked = rosterMeta?.seasonPlayers && !rosterMeta.season
    ? "시즌 선수 자료가 불러와지지 않았거나 저장된 시즌 선수를 현재 자료에서 확인하지 못해 선수 구성은 함께 저장할 수 없습니다. 밴픽만 저장하거나 시즌 자료를 다시 불러와 주세요."
    : null;
  const seasonRoot = productRootHref(currentSpace);
  const loadSeasonCatalog = useCallback((signal: AbortSignal, expected?: { catalog_id: string; cutoff: string }) => loadPublishedSeasonCatalog(seasonRoot, signal, expected), [seasonRoot]);
  // Practice library gate: any board/context/mode change invalidates a pending or in-flight library load.
  const practiceBoardKey = useMemo(() => JSON.stringify([seriesReport ? [seriesReport.patch_id, seriesReport.cutoff] : null,
    blueTeamId, redTeamId, firstPickSide, games, selections, pendingChampion, positionRecord, room.active, importing, sessionReady]),
  [seriesReport, blueTeamId, redTeamId, firstPickSide, games, selections, pendingChampion, positionRecord, room.active, importing, sessionReady]);
  // Memoized above, so timer ticks and status updates never resubmit; each committed change is written immediately.
  const retrySave = useDraftSave(saveSnapshot, setStorageStatus);

  const shareSession = useMemo(() => ({ report, blueTeamId, redTeamId, games, selections, stagedChampion: pendingChampion, firstPickSide }),
    [report, blueTeamId, redTeamId, games, selections, pendingChampion, firstPickSide]);

  useEffect(() => {
    if (!timerRunning || !turn || timer <= 0) return;
    const timeout = window.setTimeout(() => setTimer((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timeout);
  }, [timer, timerRunning, turn]);

  useEffect(() => {
    const validBlue = teams.some((team) => team.team_id === blueTeamId);
    const validRed = teams.some((team) => team.team_id === redTeamId);
    if (validBlue && validRed) return;
    const { blue: nextBlue, red: nextRed } = defaultMatchup;
    const restore = window.setTimeout(() => {
      setBlueTeamId(nextBlue?.team_id ?? "");
      setRedTeamId(nextRed?.team_id ?? "");
      setSelections([]);
      setPendingChampion(null);
      setTimer(30);
      setTimerRunning(false);
    }, 0);
    return () => window.clearTimeout(restore);
  }, [blueTeamId, redTeamId, teams, defaultMatchup]);

  const championPool = useMemo(() => {
    const champions = new Map<string, string>();
    const add = (championId: string) => {
      const canonical = championAssetId(championId).toLocaleLowerCase("en-US");
      if (!champions.has(canonical)) champions.set(canonical, championId);
    };
    for (const team of teams) {
      [...team.priority_picks, ...team.frequent_bans, ...team.received_bans].forEach((item) => add(item.champion_id));
    }
    report.entries.forEach((entry) => add(entry.champion_id));
    Object.keys(catalog).forEach(add);
    return Array.from(champions.values())
      .filter((championId) => matches(championId, query))
      .sort((left, right) => nameOf(left).localeCompare(nameOf(right), "ko-KR"));
  }, [catalog, matches, nameOf, query, report.entries, teams]);
  const visibleChampions = availableOnly
    ? championPool.filter((championId) => !isChampionLocked(selections, championId, previousPicks))
    : championPool;

  // The horizontal (narrow) rail scrolls itself to keep the selected tab in view; never the page.
  // Also re-runs when the rail turns horizontal (e.g. window narrowed) so the selected tab is not left off-screen.
  useEffect(() => {
    const rail = studioRail.current;
    const tab = studioTabRefs.current[studioTabs.findIndex((item) => item.id === studioTab)];
    if (!rail || !tab || rail.scrollWidth <= rail.clientWidth) return;
    const left = tab.getBoundingClientRect().left - rail.getBoundingClientRect().left + rail.scrollLeft;
    if (left < rail.scrollLeft) rail.scrollLeft = left;
    else if (left + tab.offsetWidth > rail.scrollLeft + rail.clientWidth) rail.scrollLeft = left + tab.offsetWidth - rail.clientWidth;
  }, [studioTab, railVertical, locale]);

  function showStudioTab(tab: StudioTab, then?: () => void) {
    setStudioTab(tab);
    // Run after React commits the visibility change so focus/scroll target a visible node.
    if (then) window.setTimeout(then, 0);
  }

  /** Rail selection: if the page is scrolled past the panel start, bring the new panel's top into view. */
  function selectStudioTab(tab: StudioTab) {
    setStudioTab(tab);
    const shell = studioShell.current;
    if (shell && shell.getBoundingClientRect().top < 0) {
      window.setTimeout(() => scrollIntoViewGently(shell), 0);
    }
  }

  function onStudioTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = studioTabs.length - 1;
    // Both axes are accepted: the rail is vertical on wide screens and horizontal on narrow ones.
    const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index === 0 ? last : index - 1)
        : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next === null) return;
    event.preventDefault();
    selectStudioTab(studioTabs[next].id);
    studioTabRefs.current[next]?.focus();
  }

  /** Confirmed-slot inspection opens the champion info in the details panel; it never stages or confirms. */
  function inspectSlot(slot: InspectedSlot) {
    setInspected(slot);
    openChampionInfo();
  }

  function openChampionInfo() {
    showStudioTab("DETAILS", () => {
      const info = document.getElementById("studio-champion-info");
      scrollIntoViewGently(info);
      info?.focus({ preventScroll: true });
    });
  }

  function focusSaveRetry() {
    showStudioTab("DRAFT", () => {
      const alert = document.querySelector<HTMLElement>(".draft-save-failed");
      scrollIntoViewGently(alert, "center");
      alert?.querySelector("button")?.focus({ preventScroll: true });
    });
  }

  function resetDraft() {
    if (room.active) return;
    setLastAuto(null); setAutoHistory([]);
    setPositionState({ context: "", roles: {} });
    setSelections([]);
    setPendingChampion(null);
    setInspected(null);
    setTimer(30);
    setTimerRunning(false);
  }

  function chooseChampion(championId: string) {
    if (!roomCanAct || !canSelect || !turn || isChampionLocked(selections, championId, previousPicks)) return;
    if (!seriesReport) setSeriesReport(structuredClone(report));
    setPendingChampion(championId);
    setInspected(null);
  }

  function confirmChampion() {
    if (!roomCanAct || !canSelect || !turn || !pendingChampion || !blueTeam || !redTeam || blueTeam.team_id === redTeam.team_id) return;
    if (room.active) { room.action("SELECT", pendingChampion); return; }
    setSelections((current) => applyDraftSelection(current, pendingChampion, previousPicks, firstPickSide));
    setPendingChampion(null);
    setTimer(30);
    setQuery("");
  }

  function changeTeam(side: DraftSide, teamId: string) {
    if (room.active) return;
    if (games.length || hasCurrentWork) return;
    if (side === "BLUE") {
      setBlueTeamId(teamId);
      if (teamId === redTeamId) setRedTeamId(teams.find((team) => team.team_id !== teamId)?.team_id ?? "");
    } else {
      setRedTeamId(teamId);
      if (teamId === blueTeamId) setBlueTeamId(teams.find((team) => team.team_id !== teamId)?.team_id ?? "");
    }
    resetDraft();
  }

  function swapSides() {
    if (room.active) return;
    if (hasCurrentWork) return;
    setBlueTeamId(redTeamId);
    setRedTeamId(blueTeamId);
    resetDraft();
  }

  function undo() {
    if (room.active) return;
    setPositionState({ context: "", roles: {} });
    setSelections((current) => soloEnabled ? current.slice(0, Math.max(0, current.findLastIndex(item => item.side === manualSide))) : current.slice(0, -1));
    setLastAuto(null);
    setPendingChampion(null);
    setInspected(null);
    setTimer(30);
  }

  function nextGame() {
    if (room.active) { if (roomHostReady && room.snapshot?.status === "COMPLETE") room.action("NEXT_GAME"); return; }
    if (!blueTeam || !redTeam) return;
    const next = completeFearlessGame(games, { blue_team_id: blueTeamId, red_team_id: redTeamId, selections });
    if (next === games) return;
    setGames(next);
    resetDraft();
  }

  function reopenPreviousGame() {
    if (room.active) return;
    const last = games.at(-1);
    if (!last) return;
    setGames(games.slice(0, -1));
    setBlueTeamId(last.blue_team_id);
    setRedTeamId(last.red_team_id);
    resetDraft();
    setSelections(last.selections);
    setFirstPickSide(last.selections[0].side);
  }

  function resetSeries() {
    if (room.active) return;
    setGames([]);
    resetDraft();
    // Keep the captured data: starting the same draft again reproduces its output.
  }

  function downloadScenario() {
    if (!blueTeam || !redTeam) return;
    const blob = new Blob([serializeDraftScenario(report, blueTeam, redTeam, selections, games, pendingChampion, firstPickSide, positionRecord)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `draft-scenario-${blueTeam.team_name}-vs-${redTeam.team_name}-${report.patch_id}.json`.replace(/[^A-Za-z0-9가-힣._-]+/g, "-");
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importScenario(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file || importing || room.active) return;
    setImporting(true);
    try {
      if (file.size > MAX_DRAFT_FILE_BYTES) {
        setImportStatus({ code: "TOO_LARGE" });
        return;
      }
      const result = parseDraftSession(await file.text());
      if (!result.ok) { setImportStatus({ code: "PARSE_FAILED", reason: sessionReason(result) }); return; }
      if (room.active) return;
      // A replaced session must not be compared against an in-memory A from earlier data.
      setComparisonEpoch((epoch) => epoch + 1);
      restoreSession(result.session);
      setImportStatus({ code: "LOADED" });
    } catch { setImportStatus({ code: "READ_FAILED" }); }
    finally { input.value = ""; setImporting(false); }
  }

  const phaseLabel = turn ? format(phaseKey(turn.kind), { phase: turn.phase }) : t("draft.complete");
  const lockInNameLang = pendingChampion ? lang.name : undefined;
  const lockInLabelLang = pendingChampion ? lang.ui : undefined;
  const reasonText = (reason: SessionErrorReason) => reason.code ? t(sessionErrorKey(reason.code)) : reason.text;
  // An unrecognized parser error is shown verbatim (Korean) and marked as such.
  const reasonLang = (status: StorageStatus | ImportStatus | null) => untranslatedReason(status) ? DEFAULT_LOCALE : lang.ui;
  const storageText = storageStatus.code === "RESTORE_FAILED"
    ? format("draft.storage.RESTORE_FAILED", { reason: reasonText(storageStatus.reason) })
    : t(storageKey(storageStatus.code));
  const importText = !importStatus ? ""
    : importStatus.code === "PARSE_FAILED" ? format("draft.import.PARSE_FAILED", { reason: reasonText(importStatus.reason) })
      : importStatus.code === "TOO_LARGE" ? t("session.error.SIZE_LIMIT")
        : t(importKey(importStatus.code));
  const staged = turn && pendingChampion ? { ...turn, turn: selections.length + 1, champion_id: pendingChampion } : null;
  const focusSelection = selections.at(-1);
  // Ignore an inspection that no longer matches a confirmed slot (undo, reset, set change, import).
  const inspectedSelection = inspected
    ? selections.find((item) => sameSlot(item, inspected) && item.champion_id === inspected.champion_id) ?? null
    : null;
  const championFocus: ChampionFocus | null = inspectedSelection
    ? { champion_id: inspectedSelection.champion_id, status: "CONFIRMED", selection: inspectedSelection, inspected: true }
    : staged
      ? { champion_id: staged.champion_id, status: "STAGED", selection: staged }
      : focusSelection ? { champion_id: focusSelection.champion_id, status: "CONFIRMED", selection: focusSelection } : null;
  return <main className="draft-lab draft-studio" lang="ko">
    <WorkspaceHeader currentSpace={currentSpace}>
      <div lang={lang.ui}><span>{seriesReport ? report.fixture_only ? t("draft.data.fixture") : t("draft.data.locked") : feedLabel}</span><b>PATCH {report.patch_id}</b></div>
    </WorkspaceHeader>

    <header className="studio-workspace-header">
      <h1 lang={locale}>{t("draft.title")}</h1>
      <p lang={lang.ui}>{t("draft.intro")}</p>
      <span lang={lang.ui}>{t("draft.format")}</span>
      <LanguageSelector className="studio-locale-select" />
      {locale !== "ko" && <p className="studio-locale-note" lang={locale} role="note">{t("locale.partialNote")}</p>}
      {/* Visible from every panel; the full warning and retry stay in the draft panel. Never shown as saved. */}
      {storageStatus.code === "SAVE_FAILED" && <button type="button" className="studio-save-flag" lang={lang.ui} onClick={focusSaveRetry}>{t("draft.saveFailedFlag")}</button>}
    </header>

    {/* Team selection is shared by all panels and rendered once. */}
    <section id="draft-workspace" className="draft-match-setup" aria-label={t("draft.setupLabel")} lang={lang.ui} inert={!canSelect}>
      <TeamChooser label="BLUE TEAM" teams={teams} value={blueTeamId} onChange={(id) => changeTeam("BLUE", id)} disabled={room.active || games.length > 0 || hasCurrentWork} locale={locale} />
      <button type="button" onClick={swapSides} disabled={room.active || hasCurrentWork} aria-label={t("draft.swapLabel")}>⇄<small>{t("draft.swap")}</small></button>
      <TeamChooser label="RED TEAM" teams={teams} value={redTeamId} onChange={(id) => changeTeam("RED", id)} disabled={room.active || games.length > 0 || hasCurrentWork} locale={locale} />
      {(hasCurrentWork || games.length > 0) && <p className="draft-setup-hint">{t("draft.setupHint")}</p>}
    </section>

    <div className="studio-shell" ref={studioShell}>
    <div className="studio-tabs" ref={studioRail} lang={locale} role="tablist" aria-label={t("draft.tabsLabel")} aria-orientation={railVertical ? "vertical" : "horizontal"}>
      {studioTabs.map((tab, index) => <button
        key={tab.id}
        ref={(node) => { studioTabRefs.current[index] = node; }}
        type="button"
        role="tab"
        id={`${tab.panel}-tab`}
        aria-selected={studioTab === tab.id}
        aria-controls={tab.panel}
        tabIndex={studioTab === tab.id ? 0 : -1}
        onClick={() => selectStudioTab(tab.id)}
        onKeyDown={(event) => onStudioTabKey(event, index)}
      >{t(tab.label)}</button>)}
    </div>

    <div className="studio-panels">
    <div id={panelOf("DRAFT")} className="studio-draft-panel" role="tabpanel" aria-labelledby={`${panelOf("DRAFT")}-tab`} hidden={studioTab !== "DRAFT"}>
    <section className="solo-draft" lang="ko" aria-label="혼자 밴픽 연습">
      <div className="solo-draft-controls">
        <label><input type="checkbox" checked={soloEnabled} disabled={!canSelect || room.active} onChange={event => { setSoloEnabled(event.target.checked); setPendingChampion(null); setLastAuto(null); setAutoHistory([]); setTimerRunning(false); }} />상대 자동 밴픽</label>
        <label>내 진영<select aria-label="내 진영" value={manualSide} disabled={!canSelect || room.active} onChange={event => { if (event.target.value === "BLUE" || event.target.value === "RED") { setManualSide(event.target.value); setPendingChampion(null); setLastAuto(null); } }}><option value="BLUE">블루</option><option value="RED">레드</option></select></label>
      </div>
      <p>{room.active ? "친구 방에서는 참가자가 직접 밴픽합니다." : soloEnabled ? "내 팀만 선택하면 상대는 공개 기록을 참고해 자기 차례를 진행합니다. 자동 선택은 연습용이며 실제 팀의 전략을 예측하지 않습니다." : "켜면 혼자서도 한 팀만 조작하며 끝까지 연습할 수 있어요. 끄면 양 팀을 직접 선택합니다."}</p>
      {soloEnabled && <p role="status">{soloSeason.loading ? "시즌 선수 기록을 확인하고 있어요…" : soloSeason.error ? "시즌 자료를 확인하지 못해 현재 팀 기록·메타 후보로 연습합니다." : "같은 팀의 현재 관측 선수 시즌 기록을 함께 참고합니다. 가상 로스터 변경은 자동 상대에 반영하지 않습니다."}</p>}
      {soloWaiting && !soloSeason.loading && <p role="status">{autoChoice ? "상대가 카드를 고르고 있어요…" : "자동 선택을 확인하지 못했습니다. 자동 밴픽을 끄고 직접 이어가세요."}</p>}
      {soloAutoRecordMatches(lastAuto, selections, autoContext) && <SoloDraftExplanationPanel record={lastAuto} nameOf={nameOf} />}
      {!room.active && <SoloDraftHistoryPanel history={prunedHistory} nameOf={nameOf} patchId={report.patch_id} cutoff={report.cutoff ?? ""} />}
    </section>
    <section className="draft-series" aria-label={t("draft.seriesLabel")} lang={lang.ui}>
      <label className="draft-first-selection">{t("draft.firstPick")}
        <select value={firstPickSide} disabled={room.active || !canSelect || selections.length > 0 || Boolean(pendingChampion)} onChange={(event) => {
          const side = event.target.value;
          if (side === "BLUE" || side === "RED") { setFirstPickSide(side); if (!seriesReport) setSeriesReport(structuredClone(report)); }
        }}><option value="BLUE">{t("draft.firstPick.BLUE")}</option><option value="RED">{t("draft.firstPick.RED")}</option></select>
        <span>{t("draft.firstPickHint")}</span>
      </label>
      <header><h2>{format("draft.seriesTitle", { game: games.length + 1 })}</h2><span>{format("draft.seriesLocks", { count: previousPicks.length })}</span></header>
      {/* Korean-only until the translation pass. Visible outside the collapsed details. */}
      {storageStatus.code === "SAVE_FAILED" && <div className="draft-save-failed" role="alert" lang="ko">
        <p>이 기기에 자동 저장하지 못했습니다. 저장될 때까지 페이지를 나가면 경고가 표시됩니다.</p>
        <button type="button" onClick={retrySave} disabled={!saveSnapshot}>다시 저장</button>
        {!saveSnapshot && <small>{importing ? "파일을 불러오는 중이라 지금은 다시 저장할 수 없습니다." : "저장할 최신 밴픽이 아직 없습니다."}</small>}
        <small>현재 화면의 최신 밴픽만 다시 저장하며 이전 상태로 되돌리지 않습니다.</small>
      </div>}
      <DraftRoomPanel outgoing={shareSession} liveReport={liveReport} ready={sessionReady && !importing && feedLabel !== "FEED CONNECTING"} onRoomChange={next => { setRoom(next); if (next.active) { setSoloEnabled(false); setLastAuto(null); setAutoHistory([]); setPositionState({ context: "", roles: {} }); } }} onSnapshot={(session, reset) => {
        if (reset) setComparisonEpoch(epoch => epoch + 1);
        setSeriesReport(session.report); setBlueTeamId(session.blueTeamId); setRedTeamId(session.redTeamId);
        setGames(session.games); setSelections(session.selections); setFirstPickSide(session.firstPickSide);
        setPendingChampion(null); setInspected(null); setQuery(""); setTimer(30); setTimerRunning(false); setPendingReset(null);
      }} />
      <DraftSharePanel outgoing={shareSession} liveReport={liveReport} ready={canSelect && !room.active} incomingReady={!room.active && sessionReady && !importing && feedLabel !== "FEED CONNECTING"} onAccept={(session) => { if (room.active) return; setComparisonEpoch((epoch) => epoch + 1); setPendingReset(null); restoreSession(session); }} />
      <div className="draft-series-actions" inert={!sessionReady || importing}><button type="button" onClick={() => setPendingReset("SERIES")} disabled={room.active || (!games.length && !hasCurrentWork)}>{t("draft.resetSeries")}</button></div>
      {/* Named local practices: separate database; loading reuses the file-import reset path. */}
      <DraftPracticeLibraryPanel scenario={saveSnapshot} roster={practiceRoster} season={practiceSeason} rosterBlocked={practiceRosterBlocked} boardKey={practiceBoardKey} hasWork={hasCurrentWork || games.length > 0} locked={room.active || !sessionReady || importing}
        loadSeasonCatalog={loadSeasonCatalog}
        onLoad={(session, roster, season) => {
          if (room.active) return;
          setComparisonEpoch((epoch) => epoch + 1); setPendingReset(null); restoreSession(session);
          // Withdraw the old roster until the editor applies the saved one, so A/B and simulation never capture a mixed state.
          // Draft, current roster and season refs arrive together, already fully verified by the panel.
          if (roster) { setLiveRoster(null); setRosterRequest({ token: ++rosterToken.current, roster, season }); }
        }} />
      <details className="draft-session-details"><summary lang="ko">고급 설정 · 파일 저장·불러오기</summary>
      <p>{format("draft.sessionInfo", { state: t(seriesReport ? "draft.sessionInfo.locked" : "draft.sessionInfo.pending"), patch: report.patch_id, cutoff: report.cutoff ?? "", model: DRAFT_MODEL_VERSION })}</p>
      <div className="draft-session-controls"><button type="button" onClick={downloadScenario} disabled={!selections.length && !games.length}>{t("draft.scenarioJson")}</button><label>{t("draft.import")}<input type="file" accept=".json,application/json" disabled={room.active || !sessionReady || importing} onChange={(event) => void importScenario(event.currentTarget)} /></label><button type="button" onClick={downloadScenario} disabled={!canSelect}>{t("draft.saveJson")}</button></div>
      <p role="status" lang={reasonLang(storageStatus)}>{storageText}</p>
      {importText && <p role="status" lang={reasonLang(importStatus)}>{importText}</p>}
      <div className="draft-series-actions" inert={!sessionReady || importing}><button type="button" onClick={reopenPreviousGame} disabled={room.active || !games.length || hasCurrentWork}>{t("draft.reopen")}</button></div>
      </details>
      {games.map((game, index) => <details key={index}><summary>{format("draft.gameLocks", { game: index + 1 })}</summary><div className="draft-series-locks" lang={lang.name}>{game.selections.filter((selection) => selection.kind === "PICK").map((selection) => <span key={selection.champion_id}><img src={championImageUrl(selection.champion_id)} alt="" />{nameOf(selection.champion_id)}</span>)}</div></details>)}
    </section>

    {/* No lang on the stage/picker containers: their children set lang per control. */}
    <section className="draft-stage" aria-label={t("draft.stageLabel")} inert={!canSelect}>
      <TeamDraftColumn unassigned={blueTeam ? positionUnassigned[blueTeam.team_id] ?? [] : []} assignments={blueTeam ? positionRoles[blueTeam.team_id] : emptyChampionRoles()} positionDisabled={!canSelect || room.active} onAssign={(id, role) => assignPosition("BLUE", id, role)} onConfirm={() => confirmPositions("BLUE")} side="BLUE" team={blueTeam} selections={selections} staged={staged} active={turn?.side === "BLUE"} nameOf={nameOf} inspected={inspectedSelection} onInspect={inspectSlot} />
      <section className="draft-control-room">
        <div className={`draft-clock ${timer <= 10 ? "urgent" : ""}`} lang={lang.ui}><span>{`TURN ${Math.min(selections.length + 1, STANDARD_DRAFT_SEQUENCE.length)} / ${STANDARD_DRAFT_SEQUENCE.length}`}</span><strong>{String(timer).padStart(2, "0")}</strong><button type="button" onClick={() => setTimerRunning((running) => !running)} disabled={!turn}>{timerRunning ? t("draft.timerPause") : t("draft.timerStart")}</button></div>
        <div className={`draft-current-turn ${turn?.side.toLowerCase() ?? "complete"}`} role="status" lang={lang.ui}><span>{phaseLabel}</span><h2>{turn ? format("draft.turnHeading", { team: frame.acting_team_name ?? "", side: t(sideKey(turn.side)) }) : t("draft.scenarioComplete")}</h2><p>{turn ? format(turnHintKey(turn.kind), { slot: turn.slot }) : t("draft.turnDoneHint")}</p>{room.active && <p className="draft-room-turn">{room.role === "SPECTATOR" ? "관전 중 · 선택할 수 없습니다" : room.role === "BLUE" ? "나는 블루" : room.role === "RED" ? "나는 레드" : "참여 확인 중"} · {room.ended ? "참여 종료" : !room.connected ? "연결 확인 중" : room.sending ? "선택 반영 중" : room.snapshot?.status === "WAITING" ? "레드 참가 대기" : turn ? `${turn.side === "BLUE" ? "블루" : "레드"} 차례` : "세트 완료"}</p>}{!turn && <button type="button" disabled={room.active && !roomHostReady} onClick={nextGame}>{t("draft.nextGame")}</button>}</div>
        <progress className="draft-turn-progress" value={selections.length} max={20} aria-label={format("draft.progressLabel", { count: selections.length, total: 20 })} lang={lang.ui} />
        <section className="draft-picker" aria-label={t("draft.pickerLabel")}>
          <div className="draft-catalog" lang={lang.ui}>
          <label htmlFor="draft-search">{t("draft.search")}</label>
          <div className="draft-search-field"><input id="draft-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("draft.searchPlaceholder")} /><button type="button" disabled={!query} onClick={() => setQuery("")} aria-label={t("draft.searchClearLabel")}>{t("draft.searchClear")}</button></div>
          <div className="draft-picker-filter"><label><input type="checkbox" checked={availableOnly} onChange={(event) => setAvailableOnly(event.target.checked)} />{t("draft.availableOnly")}</label><span role="status">{format("draft.championCount", { count: visibleChampions.length })}</span></div>
          <div className="draft-picker-grid">{visibleChampions.map((championId) => {
            const fearless = isChampionLocked([], championId, previousPicks);
            const locked = isChampionLocked(selections, championId, previousPicks);
            return <button type="button" aria-pressed={pendingChampion === championId} disabled={!roomCanAct || locked || !turn} onClick={() => chooseChampion(championId)} key={championAssetId(championId)} title={fearless ? format("draft.lockReason.previous", { name: nameOf(championId) }) : locked ? format("draft.lockReason.taken", { name: nameOf(championId) }) : nameOf(championId)}><img src={championImageUrl(championId)} alt="" loading="lazy" /><span lang={lang.name}>{nameOf(championId)}</span>{locked && <b>{fearless ? t("draft.badge.fearless") : "LOCK"}</b>}</button>;
          })}</div>
          {!visibleChampions.length && <p className="draft-search-empty" role="status">{championPool.length ? t("draft.empty.locked") : t("draft.empty.none")}</p>}
          </div>
          <div className="draft-lock-in" aria-live="polite" lang={lang.ui}>
            <div>{pendingChampion && <img src={championImageUrl(pendingChampion)} alt="" />}<span lang={lockInNameLang}><small lang={lockInLabelLang}>{pendingChampion ? t("draft.stagedPending") : t("draft.selectThenConfirm")}</small>{pendingChampion ? nameOf(pendingChampion) : turn ? t("draft.chooseChampion") : t("draft.complete")}</span></div>
            {pendingChampion && <button className="draft-cancel-stage" type="button" onClick={() => setPendingChampion(null)}>{t("draft.cancelStage")}</button>}
            <button type="button" onClick={confirmChampion} disabled={!roomCanAct || !turn || !pendingChampion || !blueTeam || !redTeam}>{turn?.kind === "BAN" ? t("draft.confirm.BAN") : t("draft.confirm.PICK")}</button>
          </div>
          {/* The full champion info lives in the details panel; this only switches panels. */}
          <button type="button" className="studio-info-entry" lang={lang.ui} aria-controls={panelOf("DETAILS")} onClick={openChampionInfo}>{t("draft.championInfoOpen")}</button>
        </section>
        <div className="draft-actions" lang={lang.ui}><button type="button" onClick={undo} disabled={room.active || (soloEnabled ? !selections.some(s => s.side === manualSide) : !selections.length)} lang={soloEnabled ? "ko" : undefined}>{soloEnabled ? "내 마지막 선택 되돌리기" : t("draft.undo")}</button><button type="button" onClick={() => setPendingReset("GAME")} disabled={room.active || !hasCurrentWork}>{t("draft.resetGame")}</button></div>
        <ol className="draft-sequence-mini" aria-label={t("draft.sequenceLabel")} lang={lang.ui}>{draftSequence(firstPickSide).map((item, index) => <li className={index < selections.length ? "done" : index === selections.length ? "current" : ""} key={index}><span>{index + 1}</span><b>{item.side === "BLUE" ? "B" : "R"}{item.kind === "BAN" ? "B" : "P"}{item.slot}</b></li>)}</ol>
      </section>
      <TeamDraftColumn unassigned={redTeam ? positionUnassigned[redTeam.team_id] ?? [] : []} assignments={redTeam ? positionRoles[redTeam.team_id] : emptyChampionRoles()} positionDisabled={!canSelect || room.active} onAssign={(id, role) => assignPosition("RED", id, role)} onConfirm={() => confirmPositions("RED")} side="RED" team={redTeam} selections={selections} staged={staged} active={turn?.side === "RED"} nameOf={nameOf} inspected={inspectedSelection} onInspect={inspectSlot} />
    </section>
    {selections.length === 20 && <DraftResultPanel report={report} blueTeam={blueTeam} redTeam={redTeam} selections={selections} previousPicks={previousPicks} firstPickSide={firstPickSide} nameOf={nameOf} autoReveal={soloEnabled && studioTab === "DRAFT" && !room.active} disabled={!canSelect || room.active} onReplay={() => setPendingReset("GAME")} onNext={nextGame} positionRecord={positionRecord} />}
    {!room.active && (games.length > 0 || selections.length === 20) && <DraftSeriesRecapPanel report={report} games={games} current={recapCurrent} nameOf={nameOf} />}
    </div>

    <div id={panelOf("ROSTER")} className="studio-roster-panel" role="tabpanel" aria-labelledby={`${panelOf("ROSTER")}-tab`} hidden={studioTab !== "ROSTER"}>
    {/* Virtual roster editor (with current player evidence and season records): separate file/storage;
        never changes the draft or analysis. Its live roster is the A/B comparison's current B; an
        already frozen A is not changed retroactively. */}
    <RosterWorkshop report={report} teams={teams} blueTeam={blueTeam} redTeam={redTeam} disabled={!canSelect}
      selections={selections} previousPicks={previousPicks} focusChampionId={championFocus?.champion_id ?? null}
      publicationRoot={productRootHref(currentSpace)} defaultOpen onRosterChange={setLiveRoster} restoreRequest={rosterRequest} onRosterMeta={setRosterMeta} />
    </div>

    <div id={panelOf("DETAILS")} className="studio-details-panel" role="tabpanel" aria-labelledby={`${panelOf("DETAILS")}-tab`} hidden={studioTab !== "DETAILS"}>
    <nav className="draft-workspace-nav" aria-label="상세 분석 이동"><button type="button" onClick={() => showStudioTab("DRAFT")}>모의 밴픽으로</button><a href={productSpaceHref(currentSpace, "TEAM")}>선택한 두 팀 분석</a><a href={productSpaceHref(currentSpace, "PROOF")}>예측 검증 결과</a></nav>
    <div id="studio-champion-info" className="studio-champion-info" tabIndex={-1}>
      <DraftChampionInfo seasonLoading={soloSeason.loading} seasonHistory={soloSeason.history} focus={championFocus} report={report} blueTeam={blueTeam} redTeam={redTeam} nameOf={nameOf} onCloseInspect={() => setInspected(null)} />
    </div>
    <p className="studio-details-staged" role="status">{pendingChampion ? `${nameOf(pendingChampion)} 올려놓음 · 확정은 모의 밴픽 탭에서 합니다.` : turn ? "올려놓은 챔피언이 없습니다. 아래 후보를 누르면 올려놓기만 하고 확정하지 않습니다." : "밴픽이 완료되었습니다."}</p>
    <section id="draft-preview" className="draft-response-preview" aria-label="확정 전 상대 픽 예상" aria-live="polite">
      <h3>{pendingChampion ? `${nameOf(pendingChampion)} ${turn?.kind === "BAN" ? "밴" : "픽"}을 확정한다면` : "챔피언을 올려놓고 상대 픽을 비교하세요"}</h3>
      {preview.status === "READY" ? <>
        <p>{preview.team_name}의 다음 픽 예상 후보 · TURN {preview.target_turn}</p>
        <small>{preview.intervening_turns > 0 ? `사이에 남은 ${preview.intervening_turns}개 밴·픽은 미정입니다. 현재 사용 가능한 후보를 비교합니다.` : "바로 다음 상대 픽 차례입니다."} 공개 빈도 순위이며 픽 확률이나 카운터 예측은 아닙니다.</small>
        <ol>{preview.candidates.map((candidate) => <li key={candidate.champion_id}><img src={championImageUrl(candidate.champion_id)} alt="" /><div><strong>{nameOf(candidate.champion_id)}</strong><p>{candidate.observation}</p><small>{candidate.confidence === "LOW" ? "낮은 표본" : "팀 공개 근거 있음"} · {candidate.evidence_team_name} 근거 {candidate.team_evidence_ids.length}건 · 글로벌 근거 {candidate.global_evidence_ids.length}건</small><details><summary>근거 기록 보기</summary><p>팀 기록: {candidate.team_evidence_ids.join(", ") || "없음"}</p><p>글로벌 기록: {candidate.global_evidence_ids.join(", ") || "없음"}</p></details></div></li>)}</ol>
        {!preview.candidates.length && <p>현재 남은 챔피언 중 공개 근거가 있는 상대 픽 후보가 없습니다.</p>}
      </> : preview.status === "NO_FUTURE_PICK" ? <p>이번 선택 이후 상대의 픽 차례는 남아 있지 않습니다.</p> : <p>선택만으로 확정되지 않습니다. 후보를 바꿔 비교한 뒤 확정 버튼을 누르세요.</p>}
    </section>

    <section className="draft-agent-panel" aria-labelledby="draft-agent-title" inert={!canSelect}>
      <header><div><span>TURN-BY-TURN EVIDENCE AGENT</span><h2 id="draft-agent-title">{turn ? `${frame.acting_team_name}의 다음 ${turn.kind === "BAN" ? "밴" : "픽"} 검토안` : "밴픽 시나리오 완료"}</h2><p>{frame.boundary}</p></div><b>{frame.evidence_match_count} MATCHES</b></header>
      <div className="draft-agent-options">{frame.options.length ? frame.options.map((option) => <button type="button" className={option.lane.toLowerCase()} disabled={!roomCanAct} onClick={() => { chooseChampion(option.champion_id); scrollIntoViewGently(document.getElementById("draft-preview"), "center"); }} key={`${option.lane}:${option.champion_id}`}>
        <span>{laneLabels[option.lane]} · {option.confidence === "HIGH" ? "근거 높음" : option.confidence === "MEDIUM" ? "근거 보통" : "낮은 표본"}</span>
        <div><img src={championImageUrl(option.champion_id)} alt="" /><h3>{nameOf(option.champion_id)}</h3><small>{roleLabels[option.role ?? ""] ?? option.role ?? "역할 확인"}</small></div>
        <p>{option.observation}</p><em>{option.question}</em><b>{option.evidence_team_name} 근거 {option.team_evidence_ids.length}건 · 글로벌 {option.global_evidence_ids.length}건 · 올려놓기 →</b>
      </button>) : <div className="draft-agent-empty"><b>{frame.status === "COMPLETE" ? "COMPLETE" : "NO GROUNDED OPTION"}</b><p>{frame.status === "COMPLETE" ? "완성된 결과를 저장하고 실제 경기 결과와 비교할 수 있습니다." : "현재 조건에서 공개 근거가 있는 선택지를 만들 수 없습니다. 모의 밴픽 탭의 챔피언 목록에서 사람이 직접 선택하세요."}</p></div>}</div>
    </section>

    {/* The event-specific scout/Worlds/national-team library is retired from the evergreen studio;
        its modules and data stay as a historical archive with their own unit tests. */}
    <PartnershipPlacement />
    <div className="draft-preparation-library">
      <button type="button" onClick={() => showStudioTab("DRAFT", () => scrollIntoViewGently(document.getElementById("draft-workspace")))}>모의 밴픽으로 돌아가기</button>
    </div>
    <footer className="draft-lab-boundary"><b>검증 경계</b><p>이 에이전트는 공개 대회 픽·밴 빈도와 현재 레이더만 사용합니다. 조합 시너지·카운터·패치 강도 모델은 아직 검증되지 않았으므로 승률 예측이 아닌 공개 기록 기반 검토이며, 자동 승률과 최종 추천을 표시하지 않습니다.</p><a href={productSpaceHref(currentSpace, "PROOF")}>현재 제품 검증 상태 →</a></footer>
    </div>

    <div id={panelOf("COMPARISON")} className="studio-comparison-panel" role="tabpanel" aria-labelledby={`${panelOf("COMPARISON")}-tab`} hidden={studioTab !== "COMPARISON"}>
    <DraftComparisonPanel key={comparisonEpoch} report={report} blueTeam={blueTeam} redTeam={redTeam} selections={selections} games={games} firstPickSide={firstPickSide} roster={liveRoster} nameOf={nameOf}
      readyInput={experimentReadyInput} publicationRoot={productRootHref(currentSpace)}
      onOpenRoleAssignment={() => showStudioTab("SIMULATION", () => {
        const target = document.querySelector<HTMLElement>(`#${panelOf("SIMULATION")} .simulation-readiness-team select:not(:disabled)`)
          ?? document.querySelector<HTMLElement>(`#${panelOf("SIMULATION")} .simulation-readiness > summary`);
        target?.focus();
        if (target) scrollIntoViewGently(target);
      })} />
    </div>

    <div id={panelOf("SIMULATION")} className="studio-simulation-panel" role="tabpanel" aria-labelledby={`${panelOf("SIMULATION")}-tab`} hidden={studioTab !== "SIMULATION"}>
    {/* Simulation input gate (with assigned-champion season records): explicit champion roles +
        current rosters; no outcome is computed. */}
    <SimulationReadinessPanel key={`sim-${comparisonEpoch}`} report={report} blueTeam={blueTeam} redTeam={redTeam} selections={selections} games={games} firstPickSide={firstPickSide} roster={liveRoster} nameOf={nameOf} publicationRoot={productRootHref(currentSpace)} defaultOpen disabled={!canSelect || room.active} roleAssignments={positionRoles} onRoleAssign={(teamId, role, id) => {
      const side = teamId === blueTeamId ? "BLUE" : "RED";
      if (id) assignPosition(side, id, role);
      else { const current = positionRoles[teamId]?.[role]; if (current) assignPosition(side, current, null); }
    }} onReadyInputChange={setReadyInput} hasHistoricalPlayers={historicalPlayers}
      onOpenRoster={() => showStudioTab("ROSTER", () => {
        const target = document.getElementById(`${panelOf("ROSTER")}-tab`);
        target?.focus();
      })} />
    {/* Assumption experiment on the validated ready input; runs only on its explicit button.
        Past-season players are not experiment input, so a stale ready input is never passed on. */}
    <ExperimentReplayPanel readyInput={experimentReadyInput} blocked={!canSelect || room.active} nameOf={nameOf} />
    </div>
    </div>
    </div>
    <dialog ref={resetDialog} className="draft-reset-dialog" aria-labelledby="draft-reset-title" aria-describedby="draft-reset-description" onCancel={() => setPendingReset(null)} lang={lang.ui}>
      <h2 id="draft-reset-title">{pendingReset === "SERIES" ? t("draft.reset.seriesTitle") : t("draft.reset.gameTitle")}</h2>
      <p id="draft-reset-description">{pendingReset === "SERIES" ? t("draft.reset.seriesBody") : t("draft.reset.gameBody")}</p>
      <div><button ref={cancelReset} type="button" onClick={() => setPendingReset(null)}>{t("draft.reset.cancel")}</button><button type="button" onClick={() => { if (pendingReset === "SERIES") resetSeries(); else if (pendingReset === "GAME") resetDraft(); setPendingReset(null); }}>{t("draft.reset.confirm")}</button></div>
    </dialog>
    <footer className="studio-preview-footer" aria-label="테스트판과 Riot Games 비제휴 고지">
      <p>한국어 테스트판 · 구단은 이 브라우저에 저장됩니다. 실제 경기 승률과 완성된 경기 시뮬레이션은 제공하지 않습니다.</p>
      <p>Pro Meta Intelligence isn&apos;t endorsed by Riot Games and doesn&apos;t reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.</p>
    </footer>
  </main>;
}
