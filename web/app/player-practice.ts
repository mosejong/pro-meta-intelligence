import type { OpponentPlayerProfile, OpponentTeam } from "./radar-types";

export const PRIVATE_PRACTICE_MAX_BYTES = 256 * 1024;
export const PRIVATE_PRACTICE_MAX_ROWS = 250;

export const practiceRoles = ["TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT"] as const;
export type PracticeRole = (typeof practiceRoles)[number];

export type PrivatePracticeRow = {
  player_name: string;
  role: PracticeRole;
  champion_id: string;
  games: number;
  wins?: number;
  comfort?: number;
  last_practiced_at?: string | null;
};

export type PrivatePracticeSession = {
  schema_version: "1";
  artifact_type: "private-player-practice-session";
  team_name: string;
  recorded_at: string;
  rows: PrivatePracticeRow[];
};

export type PlayerPracticeSummary = {
  player_name: string;
  role: PracticeRole;
  games: number;
  wins: number | null;
  unique_champion_count: number;
  average_comfort: number | null;
  last_practiced_at: string | null;
  rows: PrivatePracticeRow[];
  matches_public_roster: boolean;
};

export type PracticePublicOverlap = {
  status: "PUBLIC_OVERLAP" | "PRIVATE_ONLY" | "ROSTER_UNMATCHED";
  public_game_count: number;
  public_game_rate: number | null;
};

export class PrivatePracticeError extends Error {}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizePlayerKey(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[^\p{L}\p{N}]/gu, "");
}

export function privatePracticeRowKey(row: Pick<PrivatePracticeRow, "player_name" | "role" | "champion_id">) {
  return `${normalizePlayerKey(row.player_name)}:${row.role}:${normalizePlayerKey(row.champion_id)}`;
}

function cleanText(value: unknown, label: string, maximumLength: number) {
  if (typeof value !== "string") throw new PrivatePracticeError(`${label}은(는) 문자열이어야 합니다.`);
  const cleaned = value.trim();
  const hasControlCharacter = [...cleaned].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (!cleaned || cleaned.length > maximumLength || hasControlCharacter) {
    throw new PrivatePracticeError(`${label} 값의 길이 또는 문자를 확인하세요.`);
  }
  return cleaned;
}

function integer(value: unknown, label: string, minimum: number, maximum: number) {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new PrivatePracticeError(`${label}은(는) ${minimum}~${maximum} 사이의 정수여야 합니다.`);
  }
  return Number(value);
}

function isoDate(value: unknown, label: string, nullable = false) {
  if (nullable && (value === undefined || value === null || value === "")) return null;
  const cleaned = cleanText(value, label, 40);
  if (Number.isNaN(Date.parse(cleaned))) throw new PrivatePracticeError(`${label} 날짜 형식을 확인하세요.`);
  return cleaned;
}

function matchesOwnTeam(teamName: string, ownTeam: OpponentTeam) {
  const expected = new Set([ownTeam.team_name, ...ownTeam.team_name_aliases].map(normalizePlayerKey));
  return expected.has(normalizePlayerKey(teamName));
}

export function parsePrivatePracticeSession(value: unknown, ownTeam: OpponentTeam): PrivatePracticeSession {
  if (!isObject(value)) throw new PrivatePracticeError("연습 JSON 최상위 값은 객체여야 합니다.");
  if (value.schema_version !== "1" || value.artifact_type !== "private-player-practice-session") {
    throw new PrivatePracticeError("지원하지 않는 개인 연습 JSON 형식입니다.");
  }

  const teamName = cleanText(value.team_name, "team_name", 100);
  if (!matchesOwnTeam(teamName, ownTeam)) {
    throw new PrivatePracticeError(`선택한 내 팀(${ownTeam.team_name})의 연습 데이터만 불러올 수 있습니다.`);
  }
  const recordedAt = isoDate(value.recorded_at, "recorded_at");
  if (!Array.isArray(value.rows) || value.rows.length === 0 || value.rows.length > PRIVATE_PRACTICE_MAX_ROWS) {
    throw new PrivatePracticeError(`rows는 1~${PRIVATE_PRACTICE_MAX_ROWS}개여야 합니다.`);
  }

  const seen = new Set<string>();
  const rows = value.rows.map((raw, index): PrivatePracticeRow => {
    if (!isObject(raw)) throw new PrivatePracticeError(`rows[${index}]는 객체여야 합니다.`);
    const playerName = cleanText(raw.player_name, `rows[${index}].player_name`, 64);
    const role = cleanText(raw.role, `rows[${index}].role`, 16);
    if (!practiceRoles.includes(role as PracticeRole)) {
      throw new PrivatePracticeError(`rows[${index}].role은 TOP/JUNGLE/MID/BOTTOM/SUPPORT 중 하나여야 합니다.`);
    }
    const championId = cleanText(raw.champion_id, `rows[${index}].champion_id`, 64);
    if (!/^[\p{L}\p{N} .'’-]+$/u.test(championId)) {
      throw new PrivatePracticeError(`rows[${index}].champion_id에 허용되지 않는 문자가 있습니다.`);
    }
    const games = integer(raw.games, `rows[${index}].games`, 1, 999);
    const wins = raw.wins === undefined ? undefined : integer(raw.wins, `rows[${index}].wins`, 0, games);
    const comfort = raw.comfort === undefined ? undefined : integer(raw.comfort, `rows[${index}].comfort`, 1, 5);
    const lastPracticedAt = isoDate(raw.last_practiced_at, `rows[${index}].last_practiced_at`, true);
    const duplicateKey = privatePracticeRowKey({ player_name: playerName, role: role as PracticeRole, champion_id: championId });
    if (seen.has(duplicateKey)) {
      throw new PrivatePracticeError(`rows[${index}]에 같은 선수·포지션·챔피언이 중복되었습니다.`);
    }
    seen.add(duplicateKey);
    return {
      player_name: playerName,
      role: role as PracticeRole,
      champion_id: championId,
      games,
      ...(wins === undefined ? {} : { wins }),
      ...(comfort === undefined ? {} : { comfort }),
      ...(lastPracticedAt === null ? {} : { last_practiced_at: lastPracticedAt }),
    };
  });

  return {
    schema_version: "1",
    artifact_type: "private-player-practice-session",
    team_name: teamName,
    recorded_at: recordedAt,
    rows,
  };
}

export function upsertPrivatePracticeRow(
  ownTeam: OpponentTeam,
  session: PrivatePracticeSession | null,
  row: PrivatePracticeRow,
  recordedAt = new Date().toISOString(),
) {
  const rowKey = privatePracticeRowKey(row);
  const rows = (session?.rows ?? []).filter((candidate) => privatePracticeRowKey(candidate) !== rowKey);
  return parsePrivatePracticeSession({
    schema_version: "1",
    artifact_type: "private-player-practice-session",
    team_name: ownTeam.team_name,
    recorded_at: recordedAt,
    rows: [...rows, row],
  }, ownTeam);
}

export function classifyPracticeRow(
  row: PrivatePracticeRow,
  publicPlayers: OpponentPlayerProfile[] | undefined,
): PracticePublicOverlap {
  const player = (publicPlayers ?? []).find((candidate) => (
    candidate.roster_status === "CURRENT"
    && candidate.role === row.role
    && normalizePlayerKey(candidate.player_name) === normalizePlayerKey(row.player_name)
  ));
  if (!player) return { status: "ROSTER_UNMATCHED", public_game_count: 0, public_game_rate: null };
  const champion = player.champions.find(
    (candidate) => normalizePlayerKey(candidate.champion_id) === normalizePlayerKey(row.champion_id),
  );
  if (!champion) return { status: "PRIVATE_ONLY", public_game_count: 0, public_game_rate: null };
  return {
    status: "PUBLIC_OVERLAP",
    public_game_count: champion.game_count,
    public_game_rate: champion.game_rate,
  };
}

function currentRosterKeys(players: OpponentPlayerProfile[] | undefined) {
  return new Set(
    (players ?? [])
      .filter((player) => player.roster_status === "CURRENT")
      .map((player) => `${normalizePlayerKey(player.player_name)}:${player.role}`),
  );
}

export function summarizePrivatePractice(
  session: PrivatePracticeSession,
  publicPlayers: OpponentPlayerProfile[] | undefined,
): PlayerPracticeSummary[] {
  const rosterKeys = currentRosterKeys(publicPlayers);
  const grouped = new Map<string, PrivatePracticeRow[]>();
  for (const row of session.rows) {
    const key = `${normalizePlayerKey(row.player_name)}:${row.role}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  return [...grouped.entries()].map(([key, rows]) => {
    const comfortRows = rows.filter((row) => row.comfort !== undefined);
    const datedRows = rows.filter((row) => row.last_practiced_at);
    const allRowsHaveWins = rows.every((row) => row.wins !== undefined);
    return {
      player_name: rows[0].player_name,
      role: rows[0].role,
      games: rows.reduce((total, row) => total + row.games, 0),
      wins: allRowsHaveWins ? rows.reduce((total, row) => total + (row.wins ?? 0), 0) : null,
      unique_champion_count: new Set(rows.map((row) => normalizePlayerKey(row.champion_id))).size,
      average_comfort: comfortRows.length
        ? comfortRows.reduce((total, row) => total + (row.comfort ?? 0), 0) / comfortRows.length
        : null,
      last_practiced_at: datedRows.length
        ? datedRows.map((row) => row.last_practiced_at as string).sort().at(-1) ?? null
        : null,
      rows: [...rows].sort((left, right) => right.games - left.games || left.champion_id.localeCompare(right.champion_id)),
      matches_public_roster: rosterKeys.has(key),
    };
  }).sort((left, right) => {
    const roleDifference = practiceRoles.indexOf(left.role) - practiceRoles.indexOf(right.role);
    return roleDifference || left.player_name.localeCompare(right.player_name);
  });
}

export function privatePracticeTemplate(ownTeam: OpponentTeam): PrivatePracticeSession {
  const player = (ownTeam.player_profiles ?? []).find((candidate) => candidate.roster_status === "CURRENT");
  const championId = player?.champions[0]?.champion_id ?? ownTeam.priority_picks[0]?.champion_id ?? "Azir";
  return {
    schema_version: "1",
    artifact_type: "private-player-practice-session",
    team_name: ownTeam.team_name,
    recorded_at: new Date().toISOString(),
    rows: [{
      player_name: player?.player_name ?? "선수명 입력",
      role: practiceRoles.includes(player?.role as PracticeRole) ? player?.role as PracticeRole : "MID",
      champion_id: championId,
      games: 1,
      wins: 0,
      comfort: 3,
      last_practiced_at: new Date().toISOString(),
    }],
  };
}
