"use client";

/* eslint-disable @next/next/no-img-element -- champion portraits use Riot Data Dragon */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
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
import { RosterWorkshop } from "./roster-workshop";
import { DEFAULT_LOCALE, LanguageSelector, useLocale, type Locale, type MessageKey } from "./locale";
import "./draft-workspace.css";
import "./draft-studio.css";

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

type StudioTab = "DRAFT" | "DETAILS";
const studioTabs: Array<{ id: StudioTab; label: MessageKey; panel: string }> = [
  { id: "DRAFT", label: "draft.tab.DRAFT", panel: "studio-panel-draft" },
  { id: "DETAILS", label: "draft.tab.DETAILS", panel: "studio-panel-details" },
];

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
  onInspect,
}: {
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
  const picks = selectionsFor(selections, side, "PICK");
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
    <div className="draft-pick-stack">
      {Array.from({ length: 5 }, (_, index) => {
        const preview = staged?.side === side && staged.kind === "PICK" && staged.slot === index + 1 ? staged : null;
        const confirmed = picks.find((item) => item.slot === index + 1) ?? null;
        const selection = confirmed ?? preview;
        return <article className={preview ? "staged" : selection ? "filled" : ""} key={index}
          {...(confirmed ? inspectProps(confirmed, inspected, format("draft.inspect.PICK", { side: sideLabel, slot: index + 1, name: nameOf(confirmed.champion_id) }), onInspect) : {})}>
          <b>{side === "BLUE" ? "B" : "R"}{index + 1}</b>
          {selection ? <><img src={championImageUrl(selection.champion_id)} alt="" /><div><strong lang={lang.name}>{nameOf(selection.champion_id)}</strong><span>{preview ? t("draft.column.staged") : format("draft.column.confirmed", { turn: selection.turn })}</span></div></> : <div><strong>{t("draft.column.waiting")}</strong><span>{index < 3 ? t("draft.column.phase1Pick") : t("draft.column.phase2Pick")}</span></div>}
        </article>;
      })}
    </div>
  </section>;
}

export function DraftLab({ currentSpace, report: liveReport, feedLabel }: DraftLabProps) {
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
  const [sessionReady, setSessionReady] = useState(false);
  const [importing, setImporting] = useState(false);
  const [storageStatus, setStorageStatus] = useState<StorageStatus>({ code: "CHECKING" });
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);
  // Both panels stay mounted; switching tabs only hides one, so draft, timer and lock state survive.
  const [studioTab, setStudioTab] = useState<StudioTab>("DRAFT");
  const studioTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Read-only viewing of an already-confirmed slot. Separate from pendingChampion: it never stages or confirms.
  const [inspected, setInspected] = useState<InspectedSlot | null>(null);
  // Remount key for the A/B comparison panel; its memory-only baseline A is dropped on import/restore.
  const [comparisonEpoch, setComparisonEpoch] = useState(0);
  const blueTeam = teams.find((team) => team.team_id === blueTeamId) ?? null;
  const redTeam = teams.find((team) => team.team_id === redTeamId) ?? null;
  const turn = nextDraftTurn(selections, firstPickSide);
  const frame = useMemo(
    () => buildDraftAgentFrame(report, blueTeam, redTeam, selections, previousPicks, firstPickSide),
    [blueTeam, redTeam, report, selections, previousPicks, firstPickSide],
  );
  const preview = useMemo(() => previewOpponentPick(report, blueTeam, redTeam, selections, pendingChampion, previousPicks, 3, firstPickSide),
    [report, blueTeam, redTeam, selections, pendingChampion, previousPicks, firstPickSide]);
  const canSelect = sessionReady && !importing && Boolean(blueTeam && redTeam) && (Boolean(seriesReport) || feedLabel !== "FEED CONNECTING");
  const hasCurrentWork = selections.length > 0 || Boolean(pendingChampion);

  useEffect(() => {
    if (pendingReset) { resetDialog.current?.showModal(); cancelReset.current?.focus(); }
    else resetDialog.current?.close();
  }, [pendingReset]);

  const restoreSession = useCallback((session: DraftSession) => {
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

  const saveSnapshot = useMemo(() => {
    if (!sessionReady || !seriesReport || !blueTeam || !redTeam || importing) return null;
    return serializeDraftScenario(seriesReport, blueTeam, redTeam, selections, games, pendingChampion, firstPickSide);
  }, [sessionReady, seriesReport, blueTeam, redTeam, selections, games, pendingChampion, importing, firstPickSide]);
  // Memoized above, so timer ticks and status updates never resubmit; each committed change is written immediately.
  const retrySave = useDraftSave(saveSnapshot, setStorageStatus);

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

  function showStudioTab(tab: StudioTab, then?: () => void) {
    setStudioTab(tab);
    // Run after React commits the visibility change so focus/scroll target a visible node.
    if (then) window.setTimeout(then, 0);
  }

  function onStudioTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = studioTabs.length - 1;
    const next = event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
        : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next === null) return;
    event.preventDefault();
    setStudioTab(studioTabs[next].id);
    studioTabRefs.current[next]?.focus();
  }

  function resetDraft() {
    setSelections([]);
    setPendingChampion(null);
    setInspected(null);
    setTimer(30);
    setTimerRunning(false);
  }

  function chooseChampion(championId: string) {
    if (!canSelect || !turn || isChampionLocked(selections, championId, previousPicks)) return;
    if (!seriesReport) setSeriesReport(structuredClone(report));
    setPendingChampion(championId);
    setInspected(null);
  }

  function confirmChampion() {
    if (!canSelect || !turn || !pendingChampion || !blueTeam || !redTeam || blueTeam.team_id === redTeam.team_id) return;
    setSelections((current) => applyDraftSelection(current, pendingChampion, previousPicks, firstPickSide));
    setPendingChampion(null);
    setTimer(30);
    setQuery("");
  }

  function changeTeam(side: DraftSide, teamId: string) {
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
    if (hasCurrentWork) return;
    setBlueTeamId(redTeamId);
    setRedTeamId(blueTeamId);
    resetDraft();
  }

  function undo() {
    setSelections((current) => current.slice(0, -1));
    setPendingChampion(null);
    setInspected(null);
    setTimer(30);
  }

  function nextGame() {
    if (!blueTeam || !redTeam) return;
    const next = completeFearlessGame(games, { blue_team_id: blueTeamId, red_team_id: redTeamId, selections });
    if (next === games) return;
    setGames(next);
    resetDraft();
  }

  function reopenPreviousGame() {
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
    setGames([]);
    resetDraft();
    // Keep the captured data: starting the same draft again reproduces its output.
  }

  function downloadScenario() {
    if (!blueTeam || !redTeam) return;
    const blob = new Blob([serializeDraftScenario(report, blueTeam, redTeam, selections, games, pendingChampion, firstPickSide)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `draft-scenario-${blueTeam.team_name}-vs-${redTeam.team_name}-${report.patch_id}.json`.replace(/[^A-Za-z0-9가-힣._-]+/g, "-");
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importScenario(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file || importing) return;
    setImporting(true);
    try {
      if (file.size > MAX_DRAFT_FILE_BYTES) {
        setImportStatus({ code: "TOO_LARGE" });
        return;
      }
      const result = parseDraftSession(await file.text());
      if (!result.ok) { setImportStatus({ code: "PARSE_FAILED", reason: sessionReason(result) }); return; }
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
    <header className="draft-lab-topbar">
      <a className="brand" href={productSpaceHref(currentSpace, "ONBOARDING")} aria-label={t("draft.brandLabel")} lang={lang.ui}><span className="brand-mark">PM</span><span><strong>PRO META</strong><small>INTELLIGENCE</small></span></a>
      <nav aria-label={t("draft.pagesLabel")} lang={lang.ui}><a href={productSpaceHref(currentSpace, "TEAM")}>{t("space.TEAM")}</a><a href={productSpaceHref(currentSpace, "RADAR")}>{t("space.RADAR")}</a><a href={productSpaceHref(currentSpace, "CREATOR")}>{t("space.CREATOR")}</a><a href={productSpaceHref(currentSpace, "PROOF")}>{t("space.PROOF")}</a></nav>
      <div lang={lang.ui}><span>{seriesReport ? report.fixture_only ? t("draft.data.fixture") : t("draft.data.locked") : feedLabel}</span><b>PATCH {report.patch_id}</b></div>
    </header>

    <header className="studio-workspace-header">
      <h1 lang={locale}>{t("draft.title")}</h1>
      <p lang={lang.ui}>{t("draft.intro")}</p>
      <span lang={lang.ui}>{t("draft.format")}</span>
      <LanguageSelector className="studio-locale-select" />
      {locale !== "ko" && <p className="studio-locale-note" lang={locale} role="note">{t("locale.partialNote")}</p>}
    </header>

    <div className="studio-tabs" lang={locale} role="tablist" aria-label={t("draft.tabsLabel")}>
      {studioTabs.map((tab, index) => <button
        key={tab.id}
        ref={(node) => { studioTabRefs.current[index] = node; }}
        type="button"
        role="tab"
        id={`${tab.panel}-tab`}
        aria-selected={studioTab === tab.id}
        aria-controls={tab.panel}
        tabIndex={studioTab === tab.id ? 0 : -1}
        onClick={() => setStudioTab(tab.id)}
        onKeyDown={(event) => onStudioTabKey(event, index)}
      >{t(tab.label)}</button>)}
    </div>

    <div id="studio-panel-draft" className="studio-draft-panel" role="tabpanel" aria-labelledby="studio-panel-draft-tab" hidden={studioTab !== "DRAFT"}>
    <section id="draft-workspace" className="draft-match-setup" aria-label={t("draft.setupLabel")} lang={lang.ui} inert={!canSelect}>
      <TeamChooser label="BLUE TEAM" teams={teams} value={blueTeamId} onChange={(id) => changeTeam("BLUE", id)} disabled={games.length > 0 || hasCurrentWork} locale={locale} />
      <button type="button" onClick={swapSides} disabled={hasCurrentWork} aria-label={t("draft.swapLabel")}>⇄<small>{t("draft.swap")}</small></button>
      <TeamChooser label="RED TEAM" teams={teams} value={redTeamId} onChange={(id) => changeTeam("RED", id)} disabled={games.length > 0 || hasCurrentWork} locale={locale} />
      {(hasCurrentWork || games.length > 0) && <p className="draft-setup-hint">{t("draft.setupHint")}</p>}
    </section>
    {/* Virtual roster editor: separate file/storage; does not change the draft, baseline A or analysis. */}
    <RosterWorkshop report={report} teams={teams} blueTeam={blueTeam} redTeam={redTeam} disabled={!canSelect}
      selections={selections} previousPicks={previousPicks} focusChampionId={championFocus?.champion_id ?? null}
      publicationRoot={productRootHref(currentSpace)} />

    <section className="draft-series" aria-label={t("draft.seriesLabel")} lang={lang.ui}>
      <label className="draft-first-selection">{t("draft.firstPick")}
        <select value={firstPickSide} disabled={!canSelect || selections.length > 0 || Boolean(pendingChampion)} onChange={(event) => {
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
      <details className="draft-session-details"><summary>{t("draft.sessionSummary")}</summary>
      <p>{format("draft.sessionInfo", { state: t(seriesReport ? "draft.sessionInfo.locked" : "draft.sessionInfo.pending"), patch: report.patch_id, cutoff: report.cutoff ?? "", model: DRAFT_MODEL_VERSION })}</p>
      <div className="draft-session-controls"><label>{t("draft.import")}<input type="file" accept=".json,application/json" disabled={!sessionReady || importing} onChange={(event) => void importScenario(event.currentTarget)} /></label><button type="button" onClick={downloadScenario} disabled={!canSelect}>{t("draft.saveJson")}</button></div>
      <p role="status" lang={reasonLang(storageStatus)}>{storageText}</p>
      {importText && <p role="status" lang={reasonLang(importStatus)}>{importText}</p>}
      <div className="draft-series-actions" inert={!sessionReady || importing}><button type="button" onClick={reopenPreviousGame} disabled={!games.length || hasCurrentWork}>{t("draft.reopen")}</button><button type="button" onClick={() => setPendingReset("SERIES")} disabled={!games.length && !hasCurrentWork}>{t("draft.resetSeries")}</button></div>
      </details>
      {games.map((game, index) => <details key={index}><summary>{format("draft.gameLocks", { game: index + 1 })}</summary><div className="draft-series-locks" lang={lang.name}>{game.selections.filter((selection) => selection.kind === "PICK").map((selection) => <span key={selection.champion_id}><img src={championImageUrl(selection.champion_id)} alt="" />{nameOf(selection.champion_id)}</span>)}</div></details>)}
    </section>

    {/* No lang on the stage/picker containers: they hold the Korean-only champion-info panel. */}
    <section className="draft-stage" aria-label={t("draft.stageLabel")} inert={!canSelect}>
      <TeamDraftColumn side="BLUE" team={blueTeam} selections={selections} staged={staged} active={turn?.side === "BLUE"} nameOf={nameOf} inspected={inspectedSelection} onInspect={setInspected} />
      <section className="draft-control-room">
        <div className={`draft-clock ${timer <= 10 ? "urgent" : ""}`} lang={lang.ui}><span>{`TURN ${Math.min(selections.length + 1, STANDARD_DRAFT_SEQUENCE.length)} / ${STANDARD_DRAFT_SEQUENCE.length}`}</span><strong>{String(timer).padStart(2, "0")}</strong><button type="button" onClick={() => setTimerRunning((running) => !running)} disabled={!turn}>{timerRunning ? t("draft.timerPause") : t("draft.timerStart")}</button></div>
        <div className={`draft-current-turn ${turn?.side.toLowerCase() ?? "complete"}`} role="status" lang={lang.ui}><span>{phaseLabel}</span><h2>{turn ? format("draft.turnHeading", { team: frame.acting_team_name ?? "", side: t(sideKey(turn.side)) }) : t("draft.scenarioComplete")}</h2><p>{turn ? format(turnHintKey(turn.kind), { slot: turn.slot }) : t("draft.turnDoneHint")}</p>{!turn && <button type="button" onClick={nextGame}>{t("draft.nextGame")}</button>}</div>
        <progress className="draft-turn-progress" value={selections.length} max={20} aria-label={format("draft.progressLabel", { count: selections.length, total: 20 })} lang={lang.ui} />
        <section className="draft-picker" aria-label={t("draft.pickerLabel")}>
          <div className="draft-catalog" lang={lang.ui}>
          <label htmlFor="draft-search">{t("draft.search")}</label>
          <div className="draft-search-field"><input id="draft-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("draft.searchPlaceholder")} /><button type="button" disabled={!query} onClick={() => setQuery("")} aria-label={t("draft.searchClearLabel")}>{t("draft.searchClear")}</button></div>
          <div className="draft-picker-filter"><label><input type="checkbox" checked={availableOnly} onChange={(event) => setAvailableOnly(event.target.checked)} />{t("draft.availableOnly")}</label><span role="status">{format("draft.championCount", { count: visibleChampions.length })}</span></div>
          <div className="draft-picker-grid">{visibleChampions.map((championId) => {
            const fearless = isChampionLocked([], championId, previousPicks);
            const locked = isChampionLocked(selections, championId, previousPicks);
            return <button type="button" aria-pressed={pendingChampion === championId} disabled={locked || !turn} onClick={() => chooseChampion(championId)} key={championAssetId(championId)} title={fearless ? format("draft.lockReason.previous", { name: nameOf(championId) }) : locked ? format("draft.lockReason.taken", { name: nameOf(championId) }) : nameOf(championId)}><img src={championImageUrl(championId)} alt="" loading="lazy" /><span lang={lang.name}>{nameOf(championId)}</span>{locked && <b>{fearless ? t("draft.badge.fearless") : "LOCK"}</b>}</button>;
          })}</div>
          {!visibleChampions.length && <p className="draft-search-empty" role="status">{championPool.length ? t("draft.empty.locked") : t("draft.empty.none")}</p>}
          </div>
          <div className="draft-lock-in" aria-live="polite" lang={lang.ui}>
            <div>{pendingChampion && <img src={championImageUrl(pendingChampion)} alt="" />}<span lang={lockInNameLang}><small lang={lockInLabelLang}>{pendingChampion ? t("draft.stagedPending") : t("draft.selectThenConfirm")}</small>{pendingChampion ? nameOf(pendingChampion) : turn ? t("draft.chooseChampion") : t("draft.complete")}</span></div>
            {pendingChampion && <button className="draft-cancel-stage" type="button" onClick={() => setPendingChampion(null)}>{t("draft.cancelStage")}</button>}
            <button type="button" onClick={confirmChampion} disabled={!turn || !pendingChampion || !blueTeam || !redTeam}>{turn?.kind === "BAN" ? t("draft.confirm.BAN") : t("draft.confirm.PICK")}</button>
          </div>
          <DraftChampionInfo focus={championFocus} report={report} blueTeam={blueTeam} redTeam={redTeam} nameOf={nameOf} onCloseInspect={() => setInspected(null)} />
        </section>
        <div className="draft-actions" lang={lang.ui}><button type="button" onClick={undo} disabled={!selections.length}>{t("draft.undo")}</button><button type="button" onClick={() => setPendingReset("GAME")} disabled={!hasCurrentWork}>{t("draft.resetGame")}</button><button type="button" onClick={downloadScenario} disabled={!selections.length && !games.length}>{t("draft.scenarioJson")}</button></div>
        <ol className="draft-sequence-mini" aria-label={t("draft.sequenceLabel")} lang={lang.ui}>{draftSequence(firstPickSide).map((item, index) => <li className={index < selections.length ? "done" : index === selections.length ? "current" : ""} key={index}><span>{index + 1}</span><b>{item.side === "BLUE" ? "B" : "R"}{item.kind === "BAN" ? "B" : "P"}{item.slot}</b></li>)}</ol>
      </section>
      <TeamDraftColumn side="RED" team={redTeam} selections={selections} staged={staged} active={turn?.side === "RED"} nameOf={nameOf} inspected={inspectedSelection} onInspect={setInspected} />
    </section>
    <DraftComparisonPanel key={comparisonEpoch} report={report} blueTeam={blueTeam} redTeam={redTeam} selections={selections} games={games} firstPickSide={firstPickSide} nameOf={nameOf} />
    </div>

    <div id="studio-panel-details" className="studio-details-panel" role="tabpanel" aria-labelledby="studio-panel-details-tab" hidden={studioTab !== "DETAILS"}>
    <nav className="draft-workspace-nav" aria-label="상세 분석 이동"><button type="button" onClick={() => showStudioTab("DRAFT")}>모의 밴픽으로</button><a href={productSpaceHref(currentSpace, "TEAM")}>선택한 두 팀 분석</a><a href={productSpaceHref(currentSpace, "PROOF")}>예측 검증 결과</a></nav>
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
      <div className="draft-agent-options">{frame.options.length ? frame.options.map((option) => <button type="button" className={option.lane.toLowerCase()} onClick={() => { chooseChampion(option.champion_id); scrollIntoViewGently(document.getElementById("draft-preview"), "center"); }} key={`${option.lane}:${option.champion_id}`}>
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
    <dialog ref={resetDialog} className="draft-reset-dialog" aria-labelledby="draft-reset-title" aria-describedby="draft-reset-description" onCancel={() => setPendingReset(null)} lang={lang.ui}>
      <h2 id="draft-reset-title">{pendingReset === "SERIES" ? t("draft.reset.seriesTitle") : t("draft.reset.gameTitle")}</h2>
      <p id="draft-reset-description">{pendingReset === "SERIES" ? t("draft.reset.seriesBody") : t("draft.reset.gameBody")}</p>
      <div><button ref={cancelReset} type="button" onClick={() => setPendingReset(null)}>{t("draft.reset.cancel")}</button><button type="button" onClick={() => { if (pendingReset === "SERIES") resetSeries(); else if (pendingReset === "GAME") resetDraft(); setPendingReset(null); }}>{t("draft.reset.confirm")}</button></div>
    </dialog>
  </main>;
}
