import { championAssetId } from "./champion-assets";
import type { OpponentChampionTendency, OpponentTeam, RadarEntry, RadarReport } from "./radar-types";

export type DraftSide = "BLUE" | "RED";
export type DraftActionKind = "BAN" | "PICK";

export type DraftTurn = {
  side: DraftSide;
  kind: DraftActionKind;
  slot: number;
  phase: 1 | 2;
};

export type DraftSelection = DraftTurn & {
  turn: number;
  champion_id: string;
};

export const DRAFT_MODEL_VERSION = "fearless-preview-v2";
export type DraftGame = {
  blue_team_id: string;
  red_team_id: string;
  selections: DraftSelection[];
};

// Stable binary ordering avoids locale- and input-order-dependent tie breaks.
function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareTendency(left: OpponentChampionTendency, right: OpponentChampionTendency) {
  return right.game_rate - left.game_rate || right.phase_1_count - left.phase_1_count ||
    compareText(keyOf(left.champion_id), keyOf(right.champion_id)) || compareText(left.role ?? "", right.role ?? "") ||
    right.game_count - left.game_count || right.phase_2_count - left.phase_2_count ||
    compareText(unique(left.evidence_event_ids).join("\n"), unique(right.evidence_event_ids).join("\n")) ||
    compareText(left.champion_id, right.champion_id);
}

function compareRadar(left: RadarEntry, right: RadarEntry) {
  return left.rank - right.rank || compareText(keyOf(left.champion_id), keyOf(right.champion_id)) ||
    compareText(left.role ?? "", right.role ?? "") ||
    compareText(unique(left.evidence_event_ids).join("\n"), unique(right.evidence_event_ids).join("\n")) ||
    compareText(left.champion_id, right.champion_id);
}

export function fearlessLocks(games: DraftGame[]) {
  return unique(games.flatMap((game) => game.selections.filter((selection) => selection.kind === "PICK")
    .map((selection) => championAssetId(selection.champion_id))));
}

export function completeFearlessGame(games: DraftGame[], game: DraftGame) {
  if (game.blue_team_id === game.red_team_id || !game.blue_team_id || !game.red_team_id || game.selections.length !== 20) return games;
  const first = games[0];
  if (first && [game.blue_team_id, game.red_team_id].sort().join("\n") !== [first.blue_team_id, first.red_team_id].sort().join("\n")) return games;
  const locks = fearlessLocks(games);
  let replay: DraftSelection[] = [];
  for (const selection of game.selections) {
    const expected = nextDraftTurn(replay);
    if (!expected || selection.turn !== replay.length + 1 || selection.side !== expected.side ||
      selection.kind !== expected.kind || selection.slot !== expected.slot || selection.phase !== expected.phase) return games;
    const next = applyDraftSelection(replay, selection.champion_id, locks);
    if (next === replay) return games;
    replay = next;
  }
  return [...games, { ...game, selections: replay }];
}

export type DraftAgentOption = {
  lane: "SAFE" | "PRESSURE" | "EXPERIMENT";
  champion_id: string;
  role: string | null;
  score: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  observation: string;
  question: string;
  evidence_ids: string[];
  evidence_team_name: string;
  team_evidence_ids: string[];
  global_evidence_ids: string[];
};

export type DraftAgentFrame = {
  status: "ACTIVE" | "COMPLETE" | "UNAVAILABLE";
  turn: DraftTurn | null;
  acting_team_name: string | null;
  opposing_team_name: string | null;
  options: DraftAgentOption[];
  evidence_match_count: number;
  boundary: string;
};

// Standard professional 5-ban / 5-pick sequence. The sequence is data, not UI state,
// so every replay and exported scenario follows the exact same turn order.
export const STANDARD_DRAFT_SEQUENCE: readonly DraftTurn[] = [
  { side: "BLUE", kind: "BAN", slot: 1, phase: 1 },
  { side: "RED", kind: "BAN", slot: 1, phase: 1 },
  { side: "BLUE", kind: "BAN", slot: 2, phase: 1 },
  { side: "RED", kind: "BAN", slot: 2, phase: 1 },
  { side: "BLUE", kind: "BAN", slot: 3, phase: 1 },
  { side: "RED", kind: "BAN", slot: 3, phase: 1 },
  { side: "BLUE", kind: "PICK", slot: 1, phase: 1 },
  { side: "RED", kind: "PICK", slot: 1, phase: 1 },
  { side: "RED", kind: "PICK", slot: 2, phase: 1 },
  { side: "BLUE", kind: "PICK", slot: 2, phase: 1 },
  { side: "BLUE", kind: "PICK", slot: 3, phase: 1 },
  { side: "RED", kind: "PICK", slot: 3, phase: 1 },
  { side: "RED", kind: "BAN", slot: 4, phase: 2 },
  { side: "BLUE", kind: "BAN", slot: 4, phase: 2 },
  { side: "RED", kind: "BAN", slot: 5, phase: 2 },
  { side: "BLUE", kind: "BAN", slot: 5, phase: 2 },
  { side: "RED", kind: "PICK", slot: 4, phase: 2 },
  { side: "BLUE", kind: "PICK", slot: 4, phase: 2 },
  { side: "BLUE", kind: "PICK", slot: 5, phase: 2 },
  { side: "RED", kind: "PICK", slot: 5, phase: 2 },
] as const;

const laneOrder: DraftAgentOption["lane"][] = ["SAFE", "PRESSURE", "EXPERIMENT"];

function keyOf(championId: string) {
  return championAssetId(championId).toLocaleLowerCase("en-US");
}

function unique(values: string[]) {
  return Array.from(new Set(values)).sort();
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function radarByChampion(report: RadarReport) {
  const map = new Map<string, RadarEntry[]>();
  for (const entry of report.entries) {
    if (!entry.eligible_for_review) continue;
    const key = keyOf(entry.champion_id);
    map.set(key, [...(map.get(key) ?? []), entry]);
  }
  return map;
}

function tendencyMap(items: OpponentChampionTendency[]) {
  const result = new Map<string, OpponentChampionTendency>();
  for (const item of [...items].sort(compareTendency)) {
    if (!result.has(keyOf(item.champion_id))) result.set(keyOf(item.champion_id), item);
  }
  return result;
}

function confidence(team: OpponentTeam, evidenceCount: number): DraftAgentOption["confidence"] {
  if (team.game_count >= 5 && evidenceCount >= 3) return "HIGH";
  if (team.game_count >= 3 && evidenceCount >= 1) return "MEDIUM";
  return "LOW";
}

function candidateOption(
  lane: DraftAgentOption["lane"],
  candidate: OpponentChampionTendency | RadarEntry,
  context: {
    turn: DraftTurn;
    acting: OpponentTeam;
    opposing: OpponentTeam;
    actingPicks: Map<string, OpponentChampionTendency>;
    opposingPicks: Map<string, OpponentChampionTendency>;
    radar: Map<string, RadarEntry[]>;
  },
): DraftAgentOption {
  const championId = candidate.champion_id;
  const key = keyOf(championId);
  const own = context.actingPicks.get(key);
  const enemy = context.opposingPicks.get(key);
  const radar = context.radar.get(key)?.slice().sort(compareRadar)[0];
  const evidenceIds = unique([
    ...(own?.evidence_event_ids ?? []),
    ...(enemy?.evidence_event_ids ?? []),
    ...(radar?.evidence_event_ids ?? []),
  ]);
  const observedTeam = context.turn.kind === "BAN" ? context.opposing : context.acting;
  const observedPick = context.turn.kind === "BAN" ? enemy : own;
  const teamEvidence = unique(observedPick?.evidence_event_ids ?? []);
  const globalEvidence = unique(radar?.evidence_event_ids ?? []);
  const role = observedPick?.role ?? radar?.role ?? null;
  const score = Math.round(
    (own?.game_rate ?? 0) * 100 +
    (enemy?.game_rate ?? 0) * (context.turn.kind === "BAN" ? 115 : 55) +
    (own?.phase_1_count ?? 0) * 7 +
    (enemy?.phase_1_count ?? 0) * 6 +
    (radar?.eligible_for_review ? Math.max(0, 35 - radar.rank) : 0),
  );
  const actionWord = context.turn.kind === "BAN" ? "차단" : "확보";
  const observed = observedPick
    ? `${observedTeam.team_name} 공개 경기에서 ${percent(observedPick.game_rate)} 픽 · 1페이즈 ${observedPick.phase_1_count}회`
    : `글로벌 레이더${radar ? ` #${radar.rank}` : ""} 후보 · ${observedTeam.team_name}의 직접 픽 근거 없음`;
  const question = lane === "SAFE"
    ? `${championId} ${actionWord} 후 남은 역할과 선택지를 어떻게 채울 것인가?`
    : lane === "PRESSURE"
      ? `${championId} ${actionWord}이 상대의 다음 두 선택을 실제로 제한하는가?`
      : `${championId} ${actionWord}을 실험하려면 어떤 라인·조합 조건을 먼저 확인해야 하는가?`;
  return {
    lane,
    champion_id: championId,
    role,
    score,
    confidence: confidence(
      observedTeam,
      teamEvidence.length,
    ),
    observation: observed,
    question,
    evidence_ids: evidenceIds,
    evidence_team_name: observedTeam.team_name,
    team_evidence_ids: teamEvidence,
    global_evidence_ids: globalEvidence,
  };
}

function pickFirstDistinct(
  lane: DraftAgentOption["lane"],
  candidates: Array<OpponentChampionTendency | RadarEntry>,
  locked: Set<string>,
  used: Set<string>,
  context: Parameters<typeof candidateOption>[2],
) {
  const candidate = candidates.find((item) => !locked.has(keyOf(item.champion_id)) && !used.has(keyOf(item.champion_id)));
  if (!candidate) return null;
  used.add(keyOf(candidate.champion_id));
  return candidateOption(lane, candidate, context);
}

export function nextDraftTurn(selections: DraftSelection[]) {
  return STANDARD_DRAFT_SEQUENCE[selections.length] ?? null;
}

export function isChampionLocked(selections: DraftSelection[], championId: string, previousPicks: string[] = []) {
  const key = keyOf(championId);
  return previousPicks.some((id) => keyOf(id) === key) || selections.some((selection) => keyOf(selection.champion_id) === key);
}

export function applyDraftSelection(selections: DraftSelection[], championId: string, previousPicks: string[] = []) {
  const turn = nextDraftTurn(selections);
  if (!turn || !championId.trim() || isChampionLocked(selections, championId, previousPicks)) return selections;
  return [...selections, { ...turn, turn: selections.length + 1, champion_id: championId }];
}

export function buildDraftAgentFrame(
  report: RadarReport,
  blueTeam: OpponentTeam | null,
  redTeam: OpponentTeam | null,
  selections: DraftSelection[],
  previousPicks: string[] = [],
): DraftAgentFrame {
  const turn = nextDraftTurn(selections);
  if (!blueTeam || !redTeam || blueTeam.team_id === redTeam.team_id) {
    return {
      status: "UNAVAILABLE",
      turn,
      acting_team_name: null,
      opposing_team_name: null,
      options: [],
      evidence_match_count: 0,
      boundary: "서로 다른 두 팀을 선택해야 공개 경기 근거를 비교할 수 있습니다.",
    };
  }
  if (!turn) {
    return {
      status: "COMPLETE",
      turn: null,
      acting_team_name: null,
      opposing_team_name: null,
      options: [],
      evidence_match_count: new Set([...blueTeam.evidence.match_ids, ...redTeam.evidence.match_ids]).size,
      boundary: "완성된 시나리오는 공개 경기 기반 검토 기록이며 실제 승률이나 팀의 의도를 예측하지 않습니다.",
    };
  }

  const acting = turn.side === "BLUE" ? blueTeam : redTeam;
  const opposing = turn.side === "BLUE" ? redTeam : blueTeam;
  const actingPicks = tendencyMap(acting.priority_picks);
  const opposingPicks = tendencyMap(opposing.priority_picks);
  const radar = radarByChampion(report);
  const locked = new Set([...previousPicks.map(keyOf), ...selections.map((selection) => keyOf(selection.champion_id))]);
  const used = new Set<string>();
  const rankedRadar = report.entries
    .filter((entry) => entry.eligible_for_review)
    .sort(compareRadar);
  const safeCandidates = [...(turn.kind === "BAN" ? opposing.priority_picks : acting.priority_picks)].sort(compareTendency);
  const pressureCandidates = turn.kind === "BAN"
    ? [...opposing.priority_picks].sort((left, right) => right.phase_1_count - left.phase_1_count || compareTendency(left, right))
    : acting.priority_picks.filter((pick) => opposingPicks.has(keyOf(pick.champion_id))).sort(compareTendency);
  const experimentCandidates = rankedRadar.filter((entry) => (
    !actingPicks.has(keyOf(entry.champion_id)) || !opposingPicks.has(keyOf(entry.champion_id))
  ));
  const context = { turn, acting, opposing, actingPicks, opposingPicks, radar };
  const options = [
    pickFirstDistinct("SAFE", safeCandidates, locked, used, context),
    pickFirstDistinct("PRESSURE", [...pressureCandidates, ...rankedRadar], locked, used, context),
    pickFirstDistinct("EXPERIMENT", experimentCandidates, locked, used, context),
  ].filter((option): option is DraftAgentOption => option !== null)
    .sort((left, right) => laneOrder.indexOf(left.lane) - laneOrder.indexOf(right.lane));

  return {
    status: "ACTIVE",
    turn,
    acting_team_name: acting.team_name,
    opposing_team_name: opposing.team_name,
    options,
    evidence_match_count: new Set([...acting.evidence.match_ids, ...opposing.evidence.match_ids]).size,
    boundary: "규칙 기반 Draft Agent v1입니다. 공개 픽·밴과 레이더 후보만 정렬하며 승리 확률, 스크림 결과, 선수 의도는 추정하지 않습니다.",
  };
}

export function previewOpponentPick(
  report: RadarReport,
  blueTeam: OpponentTeam | null,
  redTeam: OpponentTeam | null,
  selections: DraftSelection[],
  stagedChampion: string | null,
  previousPicks: string[] = [],
) {
  const current = nextDraftTurn(selections);
  const empty = { status: "UNAVAILABLE" as "UNAVAILABLE" | "READY" | "NO_FUTURE_PICK", team_name: "", target_turn: null as number | null, intervening_turns: 0, candidates: [] as DraftAgentOption[] };
  if (!current || !stagedChampion || !blueTeam || !redTeam || blueTeam.team_id === redTeam.team_id) return empty;
  const hypothetical = applyDraftSelection(selections, stagedChampion, previousPicks);
  if (hypothetical === selections) return empty;
  const opposite: DraftSide = current.side === "BLUE" ? "RED" : "BLUE";
  const team = opposite === "BLUE" ? blueTeam : redTeam;
  const other = opposite === "BLUE" ? redTeam : blueTeam;
  const targetIndex = STANDARD_DRAFT_SEQUENCE.findIndex((item, index) => index >= hypothetical.length && item.side === opposite && item.kind === "PICK");
  if (targetIndex === -1) return { ...empty, status: "NO_FUTURE_PICK" as const, team_name: team.team_name };
  const ownPicks = tendencyMap(team.priority_picks);
  const opponentPicks = tendencyMap(other.priority_picks);
  const radar = radarByChampion(report);
  const context = { turn: STANDARD_DRAFT_SEQUENCE[targetIndex], acting: team, opposing: other, actingPicks: ownPicks, opposingPicks: opponentPicks, radar };
  const pool = new Map<string, OpponentChampionTendency | RadarEntry>();
  for (const candidate of [...team.priority_picks].sort(compareTendency)) {
    if (!pool.has(keyOf(candidate.champion_id))) pool.set(keyOf(candidate.champion_id), candidate);
  }
  for (const candidate of report.entries.filter((entry) => entry.eligible_for_review).sort(compareRadar)) {
    if (!pool.has(keyOf(candidate.champion_id))) pool.set(keyOf(candidate.champion_id), candidate);
  }
  const candidates = [...pool.values()]
    .filter((candidate) => !isChampionLocked(hypothetical, candidate.champion_id, previousPicks))
    .map((candidate) => {
      const option = candidateOption("SAFE", candidate, context);
      const own = ownPicks.get(keyOf(candidate.champion_id));
      const entry = radar.get(keyOf(candidate.champion_id))?.slice().sort(compareRadar)[0];
      // No random sampling, wall clock, or fabricated counter/synergy weights.
      return { ...option, score: Math.round((own?.game_rate ?? 0) * 10000) +
        (own?.phase_1_count ?? 0) * 10 + (entry?.eligible_for_review ? Math.max(0, 35 - entry.rank) : 0) };
    })
    .sort((left, right) => right.score - left.score || compareText(keyOf(left.champion_id), keyOf(right.champion_id)))
    .slice(0, 3);
  return { status: "READY" as const, team_name: team.team_name, target_turn: targetIndex + 1,
    intervening_turns: targetIndex - hypothetical.length, candidates };
}

export function serializeDraftScenario(
  report: RadarReport,
  blueTeam: OpponentTeam,
  redTeam: OpponentTeam,
  selections: DraftSelection[],
  games: DraftGame[] = [],
  stagedChampion: string | null = null,
) {
  return JSON.stringify({
    schema_version: "2",
    model_version: DRAFT_MODEL_VERSION,
    artifact_type: "public-draft-scenario",
    patch_id: report.patch_id,
    cutoff: report.cutoff,
    format: "HARD_FEARLESS_5_BAN_5_PICK",
    game_number: games.length + 1,
    previous_games: games,
    fearless_locks: fearlessLocks(games),
    analysis_snapshot: report,
    blue_team: { team_id: blueTeam.team_id, team_name: blueTeam.team_name },
    red_team: { team_id: redTeam.team_id, team_name: redTeam.team_name },
    complete: selections.length === STANDARD_DRAFT_SEQUENCE.length,
    selections,
    staged_champion: stagedChampion,
    evidence: {
      match_ids: unique([...blueTeam.evidence.match_ids, ...redTeam.evidence.match_ids]),
      source_versions: report.opponent_prep?.evidence_index.source_versions ?? report.evidence_index.source_versions,
    },
    boundary: "Public-evidence scenario for human review; not a prediction or automatic draft recommendation.",
  }, null, 2);
}
