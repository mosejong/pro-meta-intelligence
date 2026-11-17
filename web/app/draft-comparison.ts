import { championAssetId } from "./champion-assets";
import { applyDraftSelection, completeFearlessGame, DRAFT_MODEL_VERSION, fearlessLocks, type DraftGame, type DraftSelection, type DraftSide } from "./draft-agent";
import { MAX_DRAFT_FILE_BYTES } from "./draft-session";
import { isRadarReport, type OpponentTeam, type RadarReport } from "./radar-types";
import {
  captureRoster,
  compareRosterCaptures,
  parseRosterExport,
  rosterComparisonRecord,
  rosterExport,
  type RosterCapture,
  type RosterComparison,
} from "./roster-comparison";

export type DraftComparisonInput = {
  report: RadarReport;
  blueTeam: OpponentTeam | null;
  redTeam: OpponentTeam | null;
  selections: DraftSelection[];
  games: DraftGame[];
  firstPickSide: DraftSide;
  /**
   * Virtual roster for this pair (`{ basis, rosters }` keyed by team ID). Omitted/null means
   * "not recorded" (legacy v1 files); it is never filled from default observations here.
   */
  roster?: { basis: unknown; rosters: unknown } | null;
};

/** Comparison key only. Display keeps the Data Dragon asset id so nameOf() resolves it. */
const keyOf = (id: string) => championAssetId(id).toLowerCase();
const SLOT_FIELDS = ["turn", "side", "kind", "slot", "phase"] as const;

export type DraftComparisonTeam = { id: string; name: string };
export type DraftComparisonSnapshot = {
  evidenceIdentity: string;
  model: string;
  patch: string;
  cutoff: string;
  teams: Record<DraftSide, DraftComparisonTeam>;
  firstPickSide: DraftSide;
  /** Detached, replay-validated prior games so a frozen A can be exported and repeated. */
  games: DraftGame[];
  selections: DraftSelection[];
  locks: string[];
  /** Detached roster at capture time; null when the source did not record one. */
  roster: RosterCapture | null;
};
export type DraftSnapshotResult = { ok: true; snapshot: DraftComparisonSnapshot } | { ok: false; message: string };

// Reports are immutable values in the studio (state is replaced, never mutated), so the
// expensive full-report fingerprint is computed once per report object, not per render/pick.
const identityCache = new WeakMap<RadarReport, string>();
/**
 * Exact evidence fingerprint: model, patch, cutoff, source versions and the entire public
 * analysis snapshot. Any evidence edit therefore fails closed instead of being compared.
 */
export function evidenceIdentityOf(report: RadarReport) {
  let identity = identityCache.get(report);
  if (identity === undefined) {
    identity = JSON.stringify({
      model: DRAFT_MODEL_VERSION, patch: report.patch_id, cutoff: report.cutoff,
      sources: report.opponent_prep?.evidence_index.source_versions ?? report.evidence_index.source_versions,
      analysis: report,
    });
    identityCache.set(report, identity);
  }
  return identity;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Untrusted (imported) records must at least be objects with a bounded champion id string. */
function validSelectionShape(value: unknown): value is DraftSelection {
  return isObject(value) && typeof value.champion_id === "string" && value.champion_id.length <= 80 &&
    /^[A-Za-z][A-Za-z0-9]*$/.test(championAssetId(value.champion_id));
}

function detachSelection(selection: DraftSelection): DraftSelection {
  return { turn: selection.turn, side: selection.side, kind: selection.kind, slot: selection.slot, phase: selection.phase,
    champion_id: championAssetId(selection.champion_id) };
}

/** Capture detached values only. No report, team, game, or selection references escape. */
export function buildDraftComparisonSnapshot(input: DraftComparisonInput): DraftSnapshotResult {
  const { report, blueTeam, redTeam, selections, games, firstPickSide, roster } = input;
  if (!blueTeam?.team_id.trim() || !redTeam?.team_id.trim() || blueTeam.team_id === redTeam.team_id) {
    return { ok: false, message: "서로 다른 블루·레드 팀을 선택하세요." };
  }
  const prep = report.opponent_prep;
  if (!prep || prep.patch_id !== report.patch_id) {
    return { ok: false, message: "분석 데이터의 팀 근거가 없거나 패치가 일치하지 않아 비교할 수 없습니다." };
  }
  // Teams must be the report's own records, not caller-supplied look-alikes.
  const blue = prep.teams.find((team) => team.team_id === blueTeam.team_id);
  const red = prep.teams.find((team) => team.team_id === redTeam.team_id);
  if (!blue || !red) return { ok: false, message: "선택한 팀이 현재 분석 데이터에 없습니다. 팀을 다시 선택하세요." };
  if (firstPickSide !== "BLUE" && firstPickSide !== "RED") return { ok: false, message: "선픽 진영을 선택하세요." };
  if (!Array.isArray(games) || !Array.isArray(selections)) return { ok: false, message: "드래프트 기록 형식이 올바르지 않습니다." };
  const pair = [blue.team_id, red.team_id].sort().join("\n");
  let history: DraftGame[] = [];
  for (const game of games) {
    if (!isObject(game) || [game.blue_team_id, game.red_team_id].sort().join("\n") !== pair) {
      return { ok: false, message: "이전 경기의 팀이 현재 두 팀과 다릅니다. 시리즈 기록을 확인하세요." };
    }
    const next = Array.isArray(game.selections) && game.selections.every(validSelectionShape) ? completeFearlessGame(history, game) : history;
    if (next === history) return { ok: false, message: "이전 경기 기록이 불완전하거나 규칙에 맞지 않습니다. 기록을 수정하세요." };
    history = next;
  }
  if (selections.length !== 20) return { ok: false, message: `픽·밴 20개를 완료하세요. 현재 ${selections.length}/20개입니다.` };
  const locks = fearlessLocks(history);
  let replay: DraftSelection[] = [];
  for (const selection of selections) {
    const next = validSelectionShape(selection) ? applyDraftSelection(replay, selection.champion_id, locks, firstPickSide) : replay;
    const expected = next[replay.length];
    if (next === replay || !expected || SLOT_FIELDS.some((field) => selection[field] !== expected[field])) {
      return { ok: false, message: `${replay.length + 1}번째 선택의 순서·중복·피어리스 잠금을 확인하고 수정하세요.` };
    }
    replay = next;
  }
  let rosterCapture: RosterCapture | null = null;
  if (roster) {
    const captured = captureRoster(report, [blue.team_id, red.team_id], roster.basis, roster.rosters);
    if (!captured.ok) return { ok: false, message: `가상 로스터: ${captured.message}` };
    rosterCapture = captured.capture;
  }
  const lockIds = new Map<string, string>();
  for (const id of locks) if (!lockIds.has(keyOf(id))) lockIds.set(keyOf(id), championAssetId(id));
  return { ok: true, snapshot: {
    evidenceIdentity: evidenceIdentityOf(report),
    model: DRAFT_MODEL_VERSION,
    patch: report.patch_id, cutoff: report.cutoff,
    teams: { BLUE: { id: blue.team_id, name: blue.team_name }, RED: { id: red.team_id, name: red.team_name } },
    firstPickSide,
    games: history.map((game) => ({ blue_team_id: game.blue_team_id, red_team_id: game.red_team_id, selections: game.selections.map(detachSelection) })),
    selections: replay.map(detachSelection),
    locks: [...lockIds.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)).map(([, id]) => id),
    roster: rosterCapture,
  } };
}

export type DraftSlotChange = { before: DraftSelection; after: DraftSelection };
export type DraftComparisonResult =
  | { ok: false; message: string }
  | {
    ok: true;
    changes: DraftSlotChange[];
    unchangedCount: number;
    teamChanges: Array<{ side: DraftSide; before: DraftComparisonTeam; after: DraftComparisonTeam }>;
    firstPickChanged: boolean;
    addedLocks: string[];
    removedLocks: string[];
    /** By team ID and role; NOT_RECORDED when either side has no roster record. */
    roster: RosterComparison;
  };

export function compareDraftSnapshots(a: DraftComparisonSnapshot, b: DraftComparisonSnapshot): DraftComparisonResult {
  if (a.evidenceIdentity !== b.evidenceIdentity || a.model !== b.model) return { ok: false,
    message: "패치·기준 시각·모델·출처 또는 분석 스냅샷이 다릅니다. 현재 근거로 기준 A를 교체하세요." };
  if (a.selections.length !== 20 || b.selections.length !== 20) return { ok: false, message: "완료된 드래프트끼리만 비교할 수 있습니다." };
  const changes: DraftSlotChange[] = [];
  for (const before of a.selections) {
    // Physical slot (side/kind/slot) is the comparison unit, so first-selection changes surface as slot changes.
    const after = b.selections.find((item) => item.side === before.side && item.kind === before.kind && item.slot === before.slot);
    if (!after) return { ok: false, message: "비교할 슬롯이 맞지 않습니다. 기준 A를 다시 고정하세요." };
    if (keyOf(before.champion_id) !== keyOf(after.champion_id)) changes.push({ before, after });
  }
  const aLocks = new Set(a.locks.map(keyOf));
  const bLocks = new Set(b.locks.map(keyOf));
  return { ok: true, changes, unchangedCount: 20 - changes.length,
    teamChanges: (["BLUE", "RED"] as const).filter((side) => a.teams[side].id !== b.teams[side].id)
      .map((side) => ({ side, before: a.teams[side], after: b.teams[side] })),
    firstPickChanged: a.firstPickSide !== b.firstPickSide,
    addedLocks: b.locks.filter((id) => !aLocks.has(keyOf(id))),
    removedLocks: a.locks.filter((id) => !bLocks.has(keyOf(id))),
    roster: compareRosterCaptures(a.roster, b.roster),
  };
}

// ---- Reproducible export -------------------------------------------------------------

export const DRAFT_COMPARISON_ARTIFACT = "public-draft-comparison";
/** v2 adds both rosters and their comparison. v1 files still replay read-only with no roster record. */
export const DRAFT_COMPARISON_SCHEMA = "2";
export const LEGACY_DRAFT_COMPARISON_SCHEMA = "1";
export const MAX_DRAFT_COMPARISON_BYTES = MAX_DRAFT_FILE_BYTES;
const COMPARISON_BOUNDARY = "Public-evidence A/B draft comparison for human review. Lists pick/ban, side, Fearless lock and virtual roster slot differences only. Rosters are checked against the embedded analysis snapshot's player observations only (no season-history file). No win probability, player effect, synergy, counter or simulation output.";

function exportInput(snapshot: DraftComparisonSnapshot & { roster: RosterCapture }) {
  return {
    blue_team: { team_id: snapshot.teams.BLUE.id, team_name: snapshot.teams.BLUE.name },
    red_team: { team_id: snapshot.teams.RED.id, team_name: snapshot.teams.RED.name },
    first_pick_side: snapshot.firstPickSide,
    previous_games: snapshot.games,
    selections: snapshot.selections,
    roster: rosterExport(snapshot.roster),
  };
}

function comparisonRecord(diff: Extract<DraftComparisonResult, { ok: true }>, schema: string) {
  const base = {
    changes: diff.changes.map(({ before, after }) => ({ side: before.side, kind: before.kind, slot: before.slot, a: before.champion_id, b: after.champion_id })),
    unchanged_count: diff.unchangedCount,
    team_changes: diff.teamChanges.map(({ side, before, after }) => ({ side, a: before.id, b: after.id })),
    first_pick_changed: diff.firstPickChanged,
    added_locks: diff.addedLocks,
    removed_locks: diff.removedLocks,
  };
  return schema === LEGACY_DRAFT_COMPARISON_SCHEMA ? base : { ...base, roster: rosterComparisonRecord(diff.roster) };
}

export type DraftComparisonExport = { ok: true; text: string; bytes: number } | { ok: false; message: string };

/**
 * Both inputs plus the shared public analysis snapshot and its identity (patch, cutoff, model,
 * sources). No staged champion, timer, local storage or other private session state is written.
 */
export function serializeDraftComparison(report: RadarReport, a: DraftComparisonSnapshot, b: DraftComparisonSnapshot): DraftComparisonExport {
  if (evidenceIdentityOf(report) !== a.evidenceIdentity) return { ok: false, message: "현재 분석 데이터가 기준 A와 다릅니다. 기준 A를 교체한 뒤 저장하세요." };
  const diff = compareDraftSnapshots(a, b);
  if (!diff.ok) return { ok: false, message: diff.message };
  if (!a.roster || !b.roster) return { ok: false, message: "기준 A와 현재 B 모두 가상 로스터가 기록되어야 저장할 수 있습니다." };
  const text = JSON.stringify({
    artifact_type: DRAFT_COMPARISON_ARTIFACT,
    schema_version: DRAFT_COMPARISON_SCHEMA,
    format: "HARD_FEARLESS_5_BAN_5_PICK",
    model_version: a.model,
    patch_id: report.patch_id,
    cutoff: report.cutoff,
    evidence: { source_versions: report.opponent_prep?.evidence_index.source_versions ?? report.evidence_index.source_versions },
    analysis_snapshot: report,
    baseline_a: exportInput({ ...a, roster: a.roster }),
    current_b: exportInput({ ...b, roster: b.roster }),
    comparison: comparisonRecord(diff, DRAFT_COMPARISON_SCHEMA),
    boundary: COMPARISON_BOUNDARY,
  }, null, 2);
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > MAX_DRAFT_COMPARISON_BYTES) return { ok: false, message: "비교 파일이 16MB를 넘어 저장하지 않았습니다." };
  return { ok: true, text, bytes };
}

export type DraftComparisonReplay =
  | { ok: true; schema: string; a: DraftComparisonSnapshot; b: DraftComparisonSnapshot; comparison: Extract<DraftComparisonResult, { ok: true }> }
  | { ok: false; message: string };

/** File entry point: rejects oversize files from metadata before reading their contents. */
export async function replayDraftComparisonFile(file: Pick<Blob, "size" | "text">): Promise<DraftComparisonReplay> {
  if (!Number.isFinite(file.size) || file.size > MAX_DRAFT_COMPARISON_BYTES) return { ok: false, message: "비교 파일은 16MB 이하여야 합니다." };
  let text: string;
  try { text = await file.text(); } catch { return { ok: false, message: "파일을 읽지 못했습니다. 다시 선택하세요." }; }
  // Untrusted content: any unexpected shape fails closed instead of breaking the studio.
  try { return replayDraftComparison(text); } catch { return { ok: false, message: "비교 파일의 내용이 올바르지 않습니다." }; }
}

/** Reviewer path: replay both inputs from the file itself and require the recorded result to match. */
export function replayDraftComparison(text: string): DraftComparisonReplay {
  if (new TextEncoder().encode(text).byteLength > MAX_DRAFT_COMPARISON_BYTES) return { ok: false, message: "비교 파일은 16MB 이하여야 합니다." };
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { ok: false, message: "JSON 파일을 읽을 수 없습니다." }; }
  if (!isObject(value) || value.artifact_type !== DRAFT_COMPARISON_ARTIFACT ||
    (value.schema_version !== DRAFT_COMPARISON_SCHEMA && value.schema_version !== LEGACY_DRAFT_COMPARISON_SCHEMA) ||
    value.format !== "HARD_FEARLESS_5_BAN_5_PICK") return { ok: false, message: "지원하는 드래프트 비교 파일이 아닙니다." };
  const schema = value.schema_version === LEGACY_DRAFT_COMPARISON_SCHEMA ? LEGACY_DRAFT_COMPARISON_SCHEMA : DRAFT_COMPARISON_SCHEMA;
  if (value.model_version !== DRAFT_MODEL_VERSION) return { ok: false, message: "분석 모델 버전이 달라 재현할 수 없습니다." };
  const report = value.analysis_snapshot;
  if (!isRadarReport(report) || !report.opponent_prep) return { ok: false, message: "분석 데이터가 없거나 손상되었습니다." };
  if (value.patch_id !== report.patch_id || value.cutoff !== report.cutoff) return { ok: false, message: "패치 또는 기준 시점이 분석 데이터와 일치하지 않습니다." };
  const sourceVersions = report.opponent_prep.evidence_index.source_versions;
  if (!isObject(value.evidence) || JSON.stringify(value.evidence.source_versions) !== JSON.stringify(sourceVersions)) {
    return { ok: false, message: "파일의 출처 버전이 포함된 분석 데이터와 일치하지 않습니다." };
  }
  const replayInput = (raw: unknown): DraftSnapshotResult => {
    if (!isObject(raw) || !isObject(raw.blue_team) || !isObject(raw.red_team)) return { ok: false, message: "팀 정보가 없습니다." };
    const teams = report.opponent_prep!.teams;
    const blueTeam = teams.find((team) => team.team_id === (raw.blue_team as Record<string, unknown>).team_id) ?? null;
    const redTeam = teams.find((team) => team.team_id === (raw.red_team as Record<string, unknown>).team_id) ?? null;
    // v1 recorded no roster: it stays "not recorded" and is never filled from current observations.
    let roster: DraftComparisonInput["roster"] = null;
    if (schema === DRAFT_COMPARISON_SCHEMA) {
      const parsed = parseRosterExport(raw.roster, report);
      if (!parsed.ok) return { ok: false, message: `가상 로스터: ${parsed.message}` };
      roster = { basis: parsed.basis, rosters: parsed.rosters };
    }
    return buildDraftComparisonSnapshot({ report, blueTeam, redTeam, roster,
      selections: raw.selections as DraftSelection[], games: raw.previous_games as DraftGame[], firstPickSide: raw.first_pick_side as DraftSide });
  };
  const a = replayInput(value.baseline_a);
  if (!a.ok) return { ok: false, message: `기준 A: ${a.message}` };
  const b = replayInput(value.current_b);
  if (!b.ok) return { ok: false, message: `현재 B: ${b.message}` };
  const comparison = compareDraftSnapshots(a.snapshot, b.snapshot);
  if (!comparison.ok) return comparison;
  if (JSON.stringify(comparisonRecord(comparison, schema)) !== JSON.stringify(value.comparison)) {
    return { ok: false, message: "기록된 비교 결과가 입력을 다시 계산한 결과와 다릅니다." };
  }
  return { ok: true, schema, a: a.snapshot, b: b.snapshot, comparison };
}
