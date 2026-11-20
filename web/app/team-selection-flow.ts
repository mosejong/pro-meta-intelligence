/**
 * Two-step draft studio flow: team selection (SETUP) first, then the existing draft workspace (DRAFT).
 * Pure decisions only; the step lives in DraftLab state (no route, no hash, no storage field).
 */
export type DraftFlowStep = "SETUP" | "DRAFT";

export type DraftStartInput = {
  /** Local restore finished and the live (or frozen series) data is usable: DraftLab's `canSelect` minus team checks. */
  dataReady: boolean;
  importing: boolean;
  roomActive: boolean;
  blueTeamId: string;
  redTeamId: string;
  teamIds: readonly string[];
};

export type DraftStartBlock = "NOT_READY" | "IMPORTING" | "ROOM_ACTIVE" | "MISSING_TEAM" | "SAME_TEAM";

/**
 * Why the explicit start is unavailable, or null when it can start. Roster and simulation readiness are
 * deliberately not required: draft practice only needs data, a settled session and two distinct valid teams.
 */
export function draftStartBlock(input: DraftStartInput): DraftStartBlock | null {
  if (!input.dataReady) return "NOT_READY";
  if (input.importing) return "IMPORTING";
  if (input.roomActive) return "ROOM_ACTIVE";
  const blue = input.blueTeamId && input.teamIds.includes(input.blueTeamId);
  const red = input.redTeamId && input.teamIds.includes(input.redTeamId);
  if (!blue || !red) return "MISSING_TEAM";
  if (input.blueTeamId === input.redTeamId) return "SAME_TEAM";
  return null;
}

type RestorableSession = {
  selections: readonly unknown[];
  stagedChampion: string | null;
  games: readonly unknown[];
  positions?: Record<string, { roles: Record<string, string | null | undefined>; unassigned: readonly string[] }>;
};

/**
 * A restored session that already holds work goes straight to the draft step. An empty autosave
 * (only teams/first-pick defaults) keeps the explicit team-selection gate.
 */
export function sessionHasDraftWork(session: RestorableSession): boolean {
  if (session.selections.length > 0 || Boolean(session.stagedChampion) || session.games.length > 0) return true;
  return Object.values(session.positions ?? {}).some((team) => team.unassigned.length > 0 || Object.values(team.roles).some(Boolean));
}

/** Existing deep links whose preview/room UI lives in the draft step. Read-only: the fragment is never changed. */
export function isDraftDeepLink(hash: string): boolean {
  return hash.startsWith("#draft=") || hash.startsWith("#room=");
}

/** Board actions (stage, confirm, auto opponent, timer) run only on the visible draft step. */
export function boardInteractive(canSelect: boolean, step: DraftFlowStep): boolean {
  return canSelect && step === "DRAFT";
}

/** Short Korean reason for a disabled start (Korean-only like the rest of the new solo copy). */
export const DRAFT_START_BLOCK_TEXT: Record<DraftStartBlock, string> = {
  NOT_READY: "자료와 저장된 밴픽을 확인하고 있어요.",
  IMPORTING: "파일을 불러오는 중입니다.",
  ROOM_ACTIVE: "친구 방에 참여 중입니다.",
  MISSING_TEAM: "블루와 레드 팀을 모두 골라 주세요.",
  SAME_TEAM: "서로 다른 두 팀을 골라 주세요.",
};
