import type { OpponentTeam, RadarReport, ScheduleEvent, ScheduleParticipant, ScheduleSnapshot } from "./radar-types";
import type { TargetProfile } from "./target-profile";

export type TargetFixtureRelationship =
  | "CONFIRMED_HEAD_TO_HEAD"
  | "TARGET_AS_OWN_TEAM"
  | "TARGET_FIXTURE_OTHER_OPPONENT"
  | "PARTICIPANT_TBD"
  | "PERSPECTIVE_UNSET"
  | "NO_UPCOMING_FIXTURE"
  | "SCHEDULE_UNAVAILABLE";

export type TargetMatchDayBrief = {
  schema_version: "1";
  artifact_type: "target-match-day-brief";
  patch_id: string;
  cutoff: string;
  reference_at: string;
  target: {
    team_id: string;
    team_name: string;
    game_count: number;
  };
  perspective_team: {
    team_id: string;
    team_name: string;
  } | null;
  fixture: {
    relationship: TargetFixtureRelationship;
    event_id: string | null;
    start_at: string | null;
    league: string | null;
    block: string | null;
    best_of: number | null;
    participants: ScheduleParticipant[];
    other_participant: ScheduleParticipant | null;
    days_until: number | null;
    schedule_source_id: string | null;
    schedule_content_hash: string | null;
  };
  readiness: {
    status: "READY" | "SCENARIO_ONLY" | "WAITING_FOR_OPPONENT" | "WAITING_FOR_FIXTURE";
    checks: Array<{
      id: "OFFICIAL_FIXTURE" | "OPPONENT_IDENTITY" | "PUBLIC_DRAFT_SAMPLE" | "PLAYER_PROFILE" | "HISTORICAL_SERIES_LINK";
      status: "PASS" | "WAIT" | "LIMIT";
      label: string;
      detail: string;
    }>;
  };
  prepare_now: Array<{
    type: "PICK" | "BAN" | "PATCH_SHIFT" | "MATCHUP";
    title: string;
    detail: string;
    evidence_ids: string[];
  }>;
  unknowns: string[];
  evidence: {
    schedule_event_id: string | null;
    opponent_match_ids: string[];
    opponent_draft_event_ids: string[];
    source_versions: Array<{ source_id: string; source_version: string; content_hash: string }>;
  };
  boundary: string;
};

function normalizedIdentity(value: string) {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .replace(/(?:esports|gaming|team)$/u, "");
}

function participantMatchesTeam(participant: ScheduleParticipant, team: OpponentTeam) {
  const participantNames = [participant.name, participant.code].map(normalizedIdentity).filter(Boolean);
  const teamNames = [team.team_name, ...team.team_name_aliases].map(normalizedIdentity).filter(Boolean);
  return participantNames.some((name) => teamNames.includes(name));
}

function eventIncludesTeam(event: ScheduleEvent, team: OpponentTeam) {
  return event.participants.some((participant) => participantMatchesTeam(participant, team));
}

function isTbd(participant: ScheduleParticipant | null) {
  if (!participant) return true;
  return [participant.name, participant.code].some((value) => normalizedIdentity(value) === "tbd");
}

function nextTargetFixture(
  schedule: ScheduleSnapshot | null | undefined,
  target: OpponentTeam,
  referenceAt: string,
) {
  if (!schedule) return null;
  const reference = Date.parse(referenceAt);
  if (!Number.isFinite(reference)) return null;
  return schedule.events
    .filter((event) => Date.parse(event.start_at) >= reference && eventIncludesTeam(event, target))
    .sort((left, right) => Date.parse(left.start_at) - Date.parse(right.start_at))[0] ?? null;
}

function relationshipFor(
  fixture: ScheduleEvent | null,
  target: OpponentTeam,
  ownTeam?: OpponentTeam,
): TargetFixtureRelationship {
  if (!fixture) return "NO_UPCOMING_FIXTURE";
  const other = fixture.participants.find((participant) => !participantMatchesTeam(participant, target)) ?? null;
  if (isTbd(other)) return "PARTICIPANT_TBD";
  if (!ownTeam) return "PERSPECTIVE_UNSET";
  if (ownTeam.team_id === target.team_id) return "TARGET_AS_OWN_TEAM";
  if (eventIncludesTeam(fixture, ownTeam)) return "CONFIRMED_HEAD_TO_HEAD";
  return "TARGET_FIXTURE_OTHER_OPPONENT";
}

function readinessStatus(
  relationship: TargetFixtureRelationship,
): TargetMatchDayBrief["readiness"]["status"] {
  if (relationship === "SCHEDULE_UNAVAILABLE" || relationship === "NO_UPCOMING_FIXTURE") {
    return "WAITING_FOR_FIXTURE";
  }
  if (relationship === "PARTICIPANT_TBD") return "WAITING_FOR_OPPONENT";
  if (relationship === "CONFIRMED_HEAD_TO_HEAD" || relationship === "TARGET_AS_OWN_TEAM") return "READY";
  return "SCENARIO_ONLY";
}

function daysUntil(fixture: ScheduleEvent | null, referenceAt: string) {
  if (!fixture) return null;
  const elapsed = Date.parse(fixture.start_at) - Date.parse(referenceAt);
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  return Math.max(0, Math.ceil(elapsed / (24 * 60 * 60 * 1000)));
}

function prepareNow(target: OpponentTeam, profile: TargetProfile | null) {
  const items: TargetMatchDayBrief["prepare_now"] = [];
  const pick = target.priority_picks[0];
  if (pick) {
    items.push({
      type: "PICK",
      title: `${pick.champion_id} ${pick.role ?? "역할 미상"} 우선권 점검`,
      detail: `${target.game_count}경기 중 ${pick.game_count}경기에서 관측됐습니다. 1페이즈 등장 ${pick.phase_1_count}회를 포함해 응답 순서를 검토합니다.`,
      evidence_ids: pick.evidence_event_ids,
    });
  }
  const ban = target.frequent_bans[0];
  const received = target.received_bans[0];
  if (ban || received) {
    items.push({
      type: "BAN",
      title: "밴 예산을 두 방향으로 분리",
      detail: `T1이 자주 밴한 ${ban?.champion_id ?? "표본 없음"}와 T1이 자주 받은 ${received?.champion_id ?? "표본 없음"}를 같은 의도로 해석하지 않습니다.`,
      evidence_ids: [...(ban?.evidence_event_ids ?? []), ...(received?.evidence_event_ids ?? [])],
    });
  }
  const shift = profile?.patch_shift.emerging[0];
  if (shift) {
    items.push({
      type: "PATCH_SHIFT",
      title: `${shift.champion_id} ${shift.role} 패치 변화 확인`,
      detail: `${profile?.patch_shift.previous_patch_id ?? "이전 패치"} 대비 공개 경기 선택률이 ${(shift.delta * 100).toFixed(0)}%p 변했습니다. 변화 원인은 별도로 검증합니다.`,
      evidence_ids: shift.evidence_event_ids,
    });
  }
  const matchupQuestion = profile?.matchup?.staff_questions[0];
  if (matchupQuestion) {
    items.push({
      type: "MATCHUP",
      title: `${profile?.matchup?.own_team_name ?? "내 팀"} 관점 회의 질문`,
      detail: matchupQuestion,
      evidence_ids: profile.evidence.draft_event_ids,
    });
  }
  return items.slice(0, 4);
}

export function buildTargetMatchDayBrief(
  report: RadarReport,
  target: OpponentTeam,
  profile: TargetProfile | null,
  schedule?: ScheduleSnapshot | null,
  referenceAt?: string | null,
  ownTeam?: OpponentTeam,
): TargetMatchDayBrief {
  const effectiveReference = referenceAt ?? schedule?.retrieved_at ?? report.cutoff;
  const fixture = nextTargetFixture(schedule, target, effectiveReference);
  const relationship = schedule ? relationshipFor(fixture, target, ownTeam) : "SCHEDULE_UNAVAILABLE";
  const otherParticipant = fixture?.participants.find((participant) => !participantMatchesTeam(participant, target)) ?? null;
  const currentPlayers = target.player_profiles?.filter((player) => player.roster_status === "CURRENT") ?? [];
  const readiness = readinessStatus(relationship);
  const seriesAvailable = target.series_tracking?.provider_series_id_available ?? false;

  return {
    schema_version: "1",
    artifact_type: "target-match-day-brief",
    patch_id: report.patch_id,
    cutoff: report.cutoff,
    reference_at: effectiveReference,
    target: {
      team_id: target.team_id,
      team_name: target.team_name,
      game_count: target.game_count,
    },
    perspective_team: ownTeam ? { team_id: ownTeam.team_id, team_name: ownTeam.team_name } : null,
    fixture: {
      relationship,
      event_id: fixture?.event_id ?? null,
      start_at: fixture?.start_at ?? null,
      league: fixture?.league ?? null,
      block: fixture?.block ?? null,
      best_of: fixture?.best_of ?? null,
      participants: fixture?.participants ?? [],
      other_participant: otherParticipant,
      days_until: daysUntil(fixture, effectiveReference),
      schedule_source_id: schedule?.source_id ?? null,
      schedule_content_hash: schedule?.content_hash ?? null,
    },
    readiness: {
      status: readiness,
      checks: [
        {
          id: "OFFICIAL_FIXTURE",
          status: fixture ? "PASS" : "WAIT",
          label: "공식 일정",
          detail: fixture ? `${fixture.league} ${fixture.block} · ${fixture.event_id}` : "다음 T1 공식 일정이 확인되지 않았습니다.",
        },
        {
          id: "OPPONENT_IDENTITY",
          status: fixture && !isTbd(otherParticipant) ? "PASS" : "WAIT",
          label: "대진 상대",
          detail: fixture && !isTbd(otherParticipant) ? `${otherParticipant?.name} 확정` : "상대가 TBD입니다. 브래킷을 추정하지 않습니다.",
        },
        {
          id: "PUBLIC_DRAFT_SAMPLE",
          status: target.game_count >= (report.opponent_prep?.config.minimum_games_for_review ?? 3) ? "PASS" : "LIMIT",
          label: "T1 공개 드래프트",
          detail: `${target.game_count}경기 · ${target.evidence.draft_event_ids.length}개 이벤트`,
        },
        {
          id: "PLAYER_PROFILE",
          status: currentPlayers.length >= 5 ? "PASS" : "LIMIT",
          label: "최근 관측 라인업",
          detail: currentPlayers.length >= 5 ? `${currentPlayers.length}명 공개 경기 기준` : "선수 식별 표본이 부족합니다.",
        },
        {
          id: "HISTORICAL_SERIES_LINK",
          status: seriesAvailable ? "PASS" : "LIMIT",
          label: "과거 시리즈 연결",
          detail: seriesAvailable
            ? "공급자 시리즈 ID가 있습니다."
            : "공식 일정 이벤트 ID와 과거 게임 ID를 임의로 연결하지 않습니다.",
        },
      ],
    },
    prepare_now: prepareNow(target, profile),
    unknowns: [
      ...(relationship === "PARTICIPANT_TBD" ? ["공식 일정의 T1 상대가 아직 TBD입니다."] : []),
      ...(relationship === "TARGET_FIXTURE_OTHER_OPPONENT"
        ? [`이 일정은 ${ownTeam?.team_name ?? "선택한 팀"}과 T1의 직접 대진이 아닙니다.`]
        : []),
      "공개 일정은 변경될 수 있으며 선수 컨디션, 스크림, 내부 밴픽 계획은 알 수 없습니다.",
    ],
    evidence: {
      schedule_event_id: fixture?.event_id ?? null,
      opponent_match_ids: target.evidence.match_ids,
      opponent_draft_event_ids: target.evidence.draft_event_ids,
      source_versions: report.opponent_prep?.evidence_index.source_versions ?? report.evidence_index.source_versions,
    },
    boundary: "Official schedule facts and public professional-match evidence only. A schedule event ID is not treated as a historical game-series link, and TBD participants are never inferred.",
  };
}

export function serializeTargetMatchDayBrief(brief: TargetMatchDayBrief) {
  return `${JSON.stringify(brief, null, 2)}\n`;
}
