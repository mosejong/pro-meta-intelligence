import {
  EXPERIMENT_LINK_PREFIX,
  parseExperimentInputLink,
  plainDecimal,
  type ExperimentInputLink,
  type LinkRefusal,
} from "./experiment-input-link";
import { ASSUMPTION_FIELDS, parseAssumption, type AssumptionField } from "./experiment-replay";

/**
 * Team-selection notice for a received `#experiment=` link (pure decisions only).
 *
 * Reuses the existing assumption-only link codec; no new format. The link carries two public source
 * team IDs, a patch, a seed and three assumption numbers per team. It never carries bans/picks, sides,
 * players, roles or a run, so the notice can at most pick the two teams; everything else stays manual and
 * nothing ever runs automatically. Choosing teams never overwrites a draft or series in progress.
 */

export type NoticeTeamOption = { team_id: string; team_name: string };

export type NoticeContext = {
  /** Teams of the current analysis data (the setup TeamChooser options). */
  teams: readonly NoticeTeamOption[];
  /** Current analysis data patch (report.patch_id); the simulation tab only applies a link of the same patch. */
  patch: string;
  blueTeamId: string;
  redTeamId: string;
  /** Any selection/staged card in this set, or any finished set of the series. */
  hasWork: boolean;
  roomActive: boolean;
  /** Data/session loaded and no file import running. */
  ready: boolean;
};

export type ChooseRefusal = "ROOM" | "NOT_READY" | "MISSING_TEAM" | "PATCH_MISMATCH" | "IN_PROGRESS";
export type ChooseDecision =
  | { ok: true; blueTeamId: string; redTeamId: string; alreadySelected: boolean }
  | { ok: false; reason: ChooseRefusal };

export type NoticeTeam = { id: string; name: string | null; values: Record<AssumptionField, string> };

export type LinkNotice =
  | { kind: "NONE" }
  | { kind: "INVALID"; reason: LinkRefusal; message: string }
  | { kind: "RECEIVED"; encoded: string; link: ExperimentInputLink; teams: [NoticeTeam, NoticeTeam]; seedText: string;
      patchMatches: boolean; choose: ChooseDecision };

export const NOTICE_FIELD_LABELS: Record<AssumptionField, string> = { lane: "라인", tempo: "운영", teamfight: "한타" };

/** What the link can and cannot fill, shown before the user decides. */
export const NOTICE_SUPPORTED = "적용할 수 있는 것: 두 팀 선택, 두 팀의 라인·운영·한타 가정값, 재현 번호(시드).";
export const NOTICE_UNSUPPORTED = "링크에 없는 것: 밴·픽, 블루/레드 진영, 선수, 역할 배정, 실행 결과. 이것들은 직접 정해야 하고, 실행도 직접 눌러야 합니다.";
export const NOTICE_NEXT_STEPS = ["밴픽 20개를 끝내기", "시뮬레이션 준비 탭에서 역할 10개 배정", "같은 탭의 '가정값만 공유'에서 받은 가정값 적용", "가정 실험 실행을 직접 누르기"] as const;

const INVALID_TEXT: Partial<Record<LinkRefusal, string>> = {
  TOO_LONG: "링크가 너무 길어 읽지 않았어요.",
  TOO_LARGE: "링크 내용이 허용 크기를 넘어 읽지 않았어요.",
  BAD_VERSION: "지원하지 않는 가정값 링크 버전이에요.",
  BAD_RULESET: "이 화면의 가정 모델 규칙과 다른 링크예요.",
  BAD_VALUE: "링크의 가정값이나 재현 번호가 허용 범위(-1~1, 0 이상 정수)를 벗어났어요.",
  BAD_TEAMS: "링크의 두 팀 정보가 올바르지 않아요.",
};

export const CHOOSE_REFUSAL_TEXT: Record<ChooseRefusal, string> = {
  ROOM: "친구 방에 연결된 동안에는 팀을 바꿀 수 없어요.",
  NOT_READY: "분석 자료를 불러오는 중이거나 파일을 여는 중이에요. 잠시 후 다시 눌러 주세요.",
  MISSING_TEAM: "링크의 팀 중 현재 분석 자료에 없는 팀이 있어 고를 수 없어요. 지금 화면은 그대로 둡니다.",
  PATCH_MISMATCH: "링크가 만들어진 패치와 현재 분석 자료의 패치가 달라 받은 가정값을 적용할 수 없어요. 지금 화면은 그대로 둡니다.",
  IN_PROGRESS: "진행 중인 밴픽·시리즈가 있어 팀을 바꾸지 않았어요. 지금 밴픽을 끝내거나 '새 시리즈 시작'으로 초기화한 뒤 다시 눌러 주세요(필요하면 먼저 밴픽 링크나 기기 저장으로 남겨 두세요).",
};

/** Whether the "pick the link's two teams" action may change the current team selection. */
export function decideChooseTeams(link: ExperimentInputLink, context: NoticeContext): ChooseDecision {
  if (context.roomActive) return { ok: false, reason: "ROOM" };
  if (!context.ready) return { ok: false, reason: "NOT_READY" };
  const ids = new Set(context.teams.map((team) => team.team_id));
  const [first, second] = link.teams.map((team) => team.id);
  if (!ids.has(first) || !ids.has(second)) return { ok: false, reason: "MISSING_TEAM" };
  if (link.patch !== context.patch) return { ok: false, reason: "PATCH_MISMATCH" };
  // Already the two link teams (any side): nothing to change, even with work in progress.
  const current = [context.blueTeamId, context.redTeamId];
  if (current.includes(first) && current.includes(second) && first !== second) {
    return { ok: true, blueTeamId: context.blueTeamId, redTeamId: context.redTeamId, alreadySelected: true };
  }
  if (context.hasWork) return { ok: false, reason: "IN_PROGRESS" };
  // The link has no sides; keep a team already on blue/red where possible, else sorted order.
  const blue = context.redTeamId === first ? second : context.redTeamId === second ? first : context.blueTeamId === second ? second : first;
  const red = blue === first ? second : first;
  return { ok: true, blueTeamId: blue, redTeamId: red, alreadySelected: false };
}

/** Notice model for the current address. Any non-`#experiment=` hash (e.g. `#draft=`) → NONE. */
export function experimentLinkNotice(href: string, context: NoticeContext): LinkNotice {
  if (typeof href !== "string" || !href) return { kind: "NONE" };
  let hash = "";
  try { hash = new URL(href).hash; } catch { return { kind: "NONE" }; }
  if (!hash.startsWith(EXPERIMENT_LINK_PREFIX)) return { kind: "NONE" };
  const parsed = parseExperimentInputLink(href);
  if (!parsed.ok) {
    if (parsed.reason === "NO_LINK") return { kind: "NONE" };
    return { kind: "INVALID", reason: parsed.reason, message: INVALID_TEXT[parsed.reason] ?? "가정값 링크가 손상되었거나 형식이 맞지 않아 읽지 않았어요." };
  }
  const { link } = parsed;
  const teams = link.teams.map((team) => {
    const values = {} as Record<AssumptionField, string>;
    for (const field of ASSUMPTION_FIELDS) {
      const text = plainDecimal(team[field]);
      const back = text === null ? null : parseAssumption(text);
      values[field] = text !== null && back?.ok && back.value === team[field] ? text : "?";
    }
    return { id: team.id, name: context.teams.find((option) => option.team_id === team.id)?.team_name ?? null, values };
  }) as [NoticeTeam, NoticeTeam];
  if (teams.some((team) => ASSUMPTION_FIELDS.some((field) => team.values[field] === "?"))) {
    return { kind: "INVALID", reason: "BAD_VALUE", message: INVALID_TEXT.BAD_VALUE! };
  }
  return { kind: "RECEIVED", encoded: parsed.encoded, link, teams, seedText: String(link.seed),
    patchMatches: link.patch === context.patch, choose: decideChooseTeams(link, context) };
}

/** "라인 0.5 · 운영 0 · 한타 -0.25" */
export function noticeValuesText(values: Record<AssumptionField, string>): string {
  return ASSUMPTION_FIELDS.map((field) => `${NOTICE_FIELD_LABELS[field]} ${values[field]}`).join(" · ");
}
