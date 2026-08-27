import { normalizePlayerKey, type PrivatePracticeSession } from "./player-practice";
import type { OpponentPlayerProfile, OpponentTeam } from "./radar-types";

export type TendencyBotScope = "OWN_TEAM" | "OPPONENT";
export type TendencyBotIntent =
  | "SUMMARY"
  | "CHAMPION_POOL"
  | "PRACTICE_CROSSCHECK"
  | "ROLE_COMPARISON"
  | "EVIDENCE_RISK"
  | "PROHIBITED_INFERENCE";

export type TendencyBotFact = {
  label: string;
  value: string;
  detail: string;
  evidence_type: "PUBLIC_MATCH" | "PRIVATE_SESSION" | "DATA_BOUNDARY";
};

export type TendencyBotAnswer = {
  schema_version: "1";
  artifact_type: "player-tendency-bot-answer";
  answer_id: string;
  generation_mode: "DETERMINISTIC_EVIDENCE_ROUTER";
  ai_generated: false;
  scope: TendencyBotScope;
  intent: TendencyBotIntent;
  query: string;
  subject: {
    team_id: string;
    team_name: string;
    player_id: string;
    player_name: string;
    role: string;
  };
  headline: string;
  conclusion: string;
  evidence_state: "PUBLIC_ONLY" | "PUBLIC_PLUS_PRIVATE" | "LIMITED";
  facts: TendencyBotFact[];
  evidence_ids: string[];
  private_data_used: boolean;
  publishable: boolean;
  boundaries: string[];
  suggested_questions: string[];
};

export class TendencyBotError extends Error {}

const prohibitedInferencePattern = /(멘탈|성격|심리|감정|틸트|화났|불안|자신감|인성|사생활|컨디션|기량|폼|숨은\s*계정|부계정)/iu;

function normalizeQuery(query: string) {
  const normalized = query.normalize("NFKC").trim().replace(/\s+/gu, " ");
  const hasControlCharacter = [...normalized].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (!normalized || normalized.length > 160 || hasControlCharacter) {
    throw new TendencyBotError("질문은 제어문자 없이 1~160자로 입력하세요.");
  }
  return normalized;
}

export function routeTendencyQuestion(query: string): TendencyBotIntent {
  const normalized = normalizeQuery(query);
  if (prohibitedInferencePattern.test(normalized)) return "PROHIBITED_INFERENCE";
  if (/(연습|숙련|준비|내부|스크림)/iu.test(normalized)) return "PRACTICE_CROSSCHECK";
  if (/(상대|비교|대비|같은\s*포지션|맞대결)/iu.test(normalized)) return "ROLE_COMPARISON";
  if (/(근거|표본|위험|리스크|한계|믿|정확)/iu.test(normalized)) return "EVIDENCE_RISK";
  if (/(챔프|챔피언|픽|풀|주력|선호)/iu.test(normalized)) return "CHAMPION_POOL";
  return "SUMMARY";
}

function currentPlayers(team: OpponentTeam | undefined) {
  return (team?.player_profiles ?? []).filter((player) => player.roster_status === "CURRENT");
}

function selectedPlayer(team: OpponentTeam, playerId: string) {
  return currentPlayers(team).find((player) => player.player_id === playerId);
}

function sameRolePlayer(team: OpponentTeam | undefined, role: string) {
  return currentPlayers(team)
    .filter((player) => player.role === role)
    .sort((left, right) => right.game_count - left.game_count)[0];
}

function percentage(value: number) {
  return `${Math.round(value * 100)}%`;
}

function publicPoolFact(player: OpponentPlayerProfile): TendencyBotFact {
  const champions = player.champions.slice(0, 3);
  return {
    label: "반복 선택",
    value: champions.length ? champions.map((champion) => champion.champion_id).join(" · ") : "관측 없음",
    detail: champions.length
      ? champions.map((champion) => `${champion.champion_id} ${champion.game_count}G/${percentage(champion.game_rate)}`).join(" · ")
      : "현재 공개 표본에서 선수와 연결된 챔피언 픽이 없습니다.",
    evidence_type: "PUBLIC_MATCH",
  };
}

function publicEvidenceIds(player: OpponentPlayerProfile) {
  return [...new Set([
    ...player.evidence_match_ids,
    ...player.champions.flatMap((champion) => champion.evidence_event_ids),
  ])].slice(0, 30);
}

function privateRows(player: OpponentPlayerProfile, session: PrivatePracticeSession | null) {
  return (session?.rows ?? []).filter((row) => (
    row.role === player.role
    && normalizePlayerKey(row.player_name) === normalizePlayerKey(player.player_name)
  ));
}

function averageComfort(rows: ReturnType<typeof privateRows>) {
  const values = rows.flatMap((row) => row.comfort === undefined ? [] : [row.comfort]);
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function practiceFact(player: OpponentPlayerProfile, session: PrivatePracticeSession | null): TendencyBotFact {
  const rows = privateRows(player, session);
  if (!rows.length) {
    return {
      label: "내부 연습",
      value: "일치 기록 없음",
      detail: "기록 부재는 미숙련이나 준비 부족을 뜻하지 않습니다.",
      evidence_type: "DATA_BOUNDARY",
    };
  }
  const games = rows.reduce((total, row) => total + row.games, 0);
  const comfort = averageComfort(rows);
  return {
    label: "내부 연습",
    value: `${rows.length}챔피언 · ${games}G`,
    detail: `${rows.map((row) => `${row.champion_id} ${row.games}G`).join(" · ")}${comfort === null ? "" : ` · 체감 평균 ${comfort.toFixed(1)}/5`}`,
    evidence_type: "PRIVATE_SESSION",
  };
}

function comparisonFact(player: OpponentPlayerProfile, comparisonTeam: OpponentTeam | undefined): TendencyBotFact {
  const comparison = sameRolePlayer(comparisonTeam, player.role);
  const lead = player.champions[0];
  const comparisonLead = comparison?.champions[0];
  if (!comparison) {
    return {
      label: "동일 포지션 비교",
      value: "비교 표본 없음",
      detail: "선택한 비교 팀의 현재 공개 로스터에서 같은 포지션 선수를 찾지 못했습니다.",
      evidence_type: "DATA_BOUNDARY",
    };
  }
  return {
    label: "동일 포지션 비교",
    value: `${player.player_name} ↔ ${comparison.player_name}`,
    detail: `${player.player_name}: ${lead ? `${lead.champion_id} ${percentage(lead.game_rate)}` : "픽 연결 없음"} · ${comparison.player_name}: ${comparisonLead ? `${comparisonLead.champion_id} ${percentage(comparisonLead.game_rate)}` : "픽 연결 없음"}`,
    evidence_type: "PUBLIC_MATCH",
  };
}

export function answerPlayerTendencyQuestion({
  query,
  scope,
  team,
  comparisonTeam,
  playerId,
  privateSession,
}: {
  query: string;
  scope: TendencyBotScope;
  team: OpponentTeam;
  comparisonTeam?: OpponentTeam;
  playerId: string;
  privateSession: PrivatePracticeSession | null;
}): TendencyBotAnswer {
  const normalizedQuery = normalizeQuery(query);
  const intent = routeTendencyQuestion(normalizedQuery);
  const player = selectedPlayer(team, playerId);
  if (!player) throw new TendencyBotError("선택한 팀의 현재 공개 로스터에서 선수를 찾지 못했습니다.");
  const pool = player.champions.slice(0, 3);
  const lead = pool[0];
  const ownPrivateRows = scope === "OWN_TEAM" ? privateRows(player, privateSession) : [];
  const privateDataUsed = ownPrivateRows.length > 0 && ["SUMMARY", "PRACTICE_CROSSCHECK"].includes(intent);
  let headline = `${player.player_name} · 공개 선택 성향`;
  let conclusion = lead
    ? `공개 ${player.game_count}경기에서 ${lead.champion_id}가 ${lead.game_count}경기(${percentage(lead.game_rate)})로 가장 자주 관측됐습니다.`
    : `공개 ${player.game_count}경기가 연결됐지만 선수별 챔피언 표본은 없습니다.`;
  const facts: TendencyBotFact[] = [
    { label: "공개 표본", value: `${player.game_count}G`, detail: `${team.team_name} · ${player.role} · 최신 공개 로스터 기준`, evidence_type: "PUBLIC_MATCH" },
  ];

  if (intent === "PROHIBITED_INFERENCE") {
    headline = "공개 데이터로 판단할 수 없는 질문입니다.";
    conclusion = "선수의 성격, 멘탈, 심리 상태, 사생활 또는 숨은 계정은 경기 선택 기록으로 추정하지 않습니다.";
    facts.push({ label: "대신 확인 가능", value: "챔피언 반복 · 표본 · 포지션 비교", detail: "관측 가능한 행동만 질문해 주세요.", evidence_type: "DATA_BOUNDARY" });
  } else if (intent === "PRACTICE_CROSSCHECK") {
    headline = scope === "OWN_TEAM" ? `${player.player_name} · 공개 픽과 내부 연습 교차` : "상대의 비공개 연습은 분석하지 않습니다.";
    facts.push(scope === "OWN_TEAM"
      ? practiceFact(player, privateSession)
      : { label: "상대 내부 데이터", value: "수집·추정 안 함", detail: "상대 선수는 공개 경기 선택만 확인합니다.", evidence_type: "DATA_BOUNDARY" });
    conclusion = scope === "OWN_TEAM" && ownPrivateRows.length
      ? `현재 탭에서 ${ownPrivateRows.length}개 챔피언, ${ownPrivateRows.reduce((total, row) => total + row.games, 0)}경기의 내부 연습 기록이 연결됐습니다. 숙련 판정 전에 리플레이와 선수 피드백을 확인하세요.`
      : "연결된 내부 기록이 없습니다. 기록 부재는 미숙련을 뜻하지 않으며 상대의 비공개 연습은 추정하지 않습니다.";
  } else if (intent === "ROLE_COMPARISON") {
    headline = `${player.role} · 공개 선택 패턴 비교`;
    facts.push(comparisonFact(player, comparisonTeam));
    conclusion = "양쪽의 가장 반복된 공개 선택을 나란히 보여줍니다. 표본 수가 다르므로 강함이나 승부 우위를 판정하지 않습니다.";
  } else if (intent === "EVIDENCE_RISK") {
    headline = `${player.player_name} · 표본과 해석 경계`;
    const linkedEvents = player.champions.reduce((total, champion) => total + champion.evidence_event_ids.length, 0);
    facts.push({ label: "근거 연결", value: `${player.evidence_match_ids.length}경기 · ${linkedEvents}픽 이벤트`, detail: "현재 발행 스냅샷의 공개 ID만 사용", evidence_type: "PUBLIC_MATCH" });
    facts.push({ label: "해석 금지", value: "원인 · 숙련 · 출전 의도", detail: "선택 빈도는 코치 지시나 선수 상태의 증거가 아닙니다.", evidence_type: "DATA_BOUNDARY" });
    conclusion = `현재 답변은 ${player.game_count}경기 표본에 한정됩니다. 패치, 상대, 조합 맥락을 확인하기 전에는 반복 선택을 선수 고정 성향으로 일반화하면 안 됩니다.`;
  } else {
    facts.push(publicPoolFact(player));
    if (intent === "SUMMARY" && scope === "OWN_TEAM") facts.push(practiceFact(player, privateSession));
  }

  const boundaries = [
    "공개 경기 선택은 현재 숙련도, 실력, 다음 경기 출전 또는 코칭 의도를 증명하지 않습니다.",
    "선수의 성격, 멘탈, 심리, 사생활, 숨은 계정을 추정하지 않습니다.",
    scope === "OPPONENT"
      ? "상대 팀의 비공개 연습과 스크림 데이터는 수집하거나 추정하지 않습니다."
      : "내 팀 개인 연습값은 자기 보고·내부 입력이며 공개 통계와 분리합니다.",
  ];
  return {
    schema_version: "1",
    artifact_type: "player-tendency-bot-answer",
    answer_id: `${team.team_id}:${player.player_id}:${intent}`,
    generation_mode: "DETERMINISTIC_EVIDENCE_ROUTER",
    ai_generated: false,
    scope,
    intent,
    query: normalizedQuery,
    subject: {
      team_id: team.team_id,
      team_name: team.team_name,
      player_id: player.player_id,
      player_name: player.player_name,
      role: player.role,
    },
    headline,
    conclusion,
    evidence_state: intent === "PROHIBITED_INFERENCE" ? "LIMITED" : privateDataUsed ? "PUBLIC_PLUS_PRIVATE" : "PUBLIC_ONLY",
    facts,
    evidence_ids: publicEvidenceIds(player),
    private_data_used: privateDataUsed,
    publishable: !privateDataUsed,
    boundaries,
    suggested_questions: [
      "공개 경기에서 가장 반복된 챔피언은?",
      "내 연습 기록과 어디가 겹쳐?",
      "같은 포지션 상대와 비교해줘",
      "표본과 해석 위험을 알려줘",
    ],
  };
}
