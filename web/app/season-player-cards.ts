import { ROSTER_ROLES, type RosterRole, type RosterState } from "./roster-scenario";
export type SeasonCard = { id: string; source_id: string; player_id: string; player_name: string; season: number; team_id: string; team_names: string[]; role: RosterRole; game_count: number; champions: { champion_id: string; games: number }[]; patches: string[]; source_hashes: string[] };
export type SeasonCardCatalog = { artifact_type: "season-player-cards"; schema_version: 1; catalog_id: string; cutoff: string; seasons: { season: number; status: "LOADED" | "NOT_LOADED" }[]; sources: { source_id: string; season: number; content_hash: string; retrieved_at: string }[]; cards: SeasonCard[] };
export type SeasonCardRef = { catalog_id: string; card_id: string; player_id: string };
export type SeasonSlots = Record<RosterRole, SeasonCardRef | null>;
export type TeamSeasonSlots = Record<string, SeasonSlots>;
export const emptySeasonSlots = (): SeasonSlots => ({ TOP: null, JUNGLE: null, MID: null, BOTTOM: null, SUPPORT: null });
export const isCardHash = (x: unknown): x is string => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
const text = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 256;
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const time = (x: unknown): x is string => typeof x === "string" && /(?:Z|[+-]\d\d:\d\d)$/.test(x) && Number.isFinite(Date.parse(x));
export function parseSeasonCardCatalog(value: unknown): SeasonCardCatalog {
  const bad = () => new Error("시즌 선수 자료의 형식이나 출처를 확인하지 못했습니다.");
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 3 * 1024 * 1024) throw bad();
  if (!object(value) || value.artifact_type !== "season-player-cards" || value.schema_version !== 1 || !isCardHash(value.catalog_id) || !time(value.cutoff) || !Array.isArray(value.sources) || !Array.isArray(value.seasons) || !Array.isArray(value.cards) || value.cards.length > 5000) throw bad();
  const years = new Map<number, string>();
  for (const row of value.seasons) {
    if (!object(row) || !Number.isInteger(row.season) || (row.season as number) < 2014 || (row.season as number) > new Date(value.cutoff).getUTCFullYear() || years.has(row.season as number) || !["LOADED", "NOT_LOADED"].includes(row.status as string)) throw bad();
    years.set(row.season as number, row.status as string);
  }
  const sources = new Set<string>();
  for (const s of value.sources) {
    if (!object(s) || s.source_id !== "oracles-elixir-match-data" || years.get(s.season as number) !== "LOADED" || typeof s.content_hash !== "string" || !/^(?:sha256:)?[a-f0-9]{64}$/.test(s.content_hash) || !time(s.retrieved_at) || Date.parse(s.retrieved_at) > Date.parse(value.cutoff)) throw bad();
    const token = JSON.stringify([s.source_id, s.season, s.content_hash]);
    if (sources.has(token)) throw bad(); sources.add(token);
  }
  for (const [year, state] of years) if (state === "LOADED" && !value.sources.some(s => s.season === year)) throw bad();
  const ids = new Set<string>(), identities = new Set<string>();
  for (const c of value.cards) {
    if (!object(c) || !isCardHash(c.id) || ids.has(c.id) || c.source_id !== "oracles-elixir-match-data" || !text(c.player_id) || !text(c.player_name) || !text(c.team_id) || !Number.isInteger(c.season) || years.get(c.season as number) !== "LOADED" || !ROSTER_ROLES.includes(c.role as RosterRole) || !Number.isSafeInteger(c.game_count) || (c.game_count as number) < 1 || !Array.isArray(c.team_names) || !c.team_names.length || !c.team_names.every(text) || !Array.isArray(c.patches) || !c.patches.length || !c.patches.every(text) || !Array.isArray(c.source_hashes) || !c.source_hashes.length || new Set(c.source_hashes).size !== c.source_hashes.length || !c.source_hashes.every(h => sources.has(JSON.stringify([c.source_id, c.season, h]))) || !Array.isArray(c.champions)) throw bad();
    const identity = JSON.stringify([c.source_id, c.player_id, c.season, c.team_id, c.role]);
    if (identities.has(identity)) throw bad(); identities.add(identity); ids.add(c.id);
    const champs = new Set<string>(); let total = 0;
    for (const ch of c.champions) {
      if (!object(ch) || !text(ch.champion_id) || champs.has(ch.champion_id.toLowerCase()) || !Number.isSafeInteger(ch.games) || (ch.games as number) < 1) throw bad();
      champs.add(ch.champion_id.toLowerCase()); total += ch.games as number;
    }
    if (total !== c.game_count) throw bad();
  }
  return structuredClone(value) as SeasonCardCatalog;
}
/** Match the offline generator's sorted-key UTF-8 JSON; this is integrity, not a signature. */
export async function verifySeasonCardIntegrity(catalog: SeasonCardCatalog) {
  const canonical = (x: unknown): unknown => Array.isArray(x) ? x.map(canonical) : object(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
  const digest = async (x: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical(x))))), b => b.toString(16).padStart(2, "0")).join("");
  if (await digest(catalog.cards) !== catalog.catalog_id) throw new Error("시즌 카드 내용이 기록된 버전과 다릅니다.");
  for (const c of catalog.cards) if (await digest([c.source_id, c.player_id, c.season, c.team_id, c.role]) !== c.id) throw new Error("시즌 선수 식별 정보가 일치하지 않습니다.");
}
export function resolveSeasonRef(ref: SeasonCardRef, role: RosterRole, catalog: SeasonCardCatalog | null | undefined): SeasonCard {
  if (!catalog || ref.catalog_id !== catalog.catalog_id) throw new Error("먼저 저장 때와 같은 시즌 선수 자료를 불러와 주세요.");
  const card = catalog.cards.find(c => c.id === ref.card_id && c.player_id === ref.player_id && c.role === role);
  if (!card) throw new Error("저장된 시즌 선수를 자료에서 확인하지 못했습니다. 기존 구성을 유지합니다.");
  return card;
}
export function validateSeasonLineup(refs: SeasonSlots, current: RosterState, targetTeamId: string, catalog: SeasonCardCatalog | null | undefined, otherSeasons: TeamSeasonSlots = {}) {
  const seen = new Set<string>();
  for (const slots of Object.values(current)) for (const p of Object.values(slots)) if (p) seen.add(p.player_id);
  for (const [team, slots] of Object.entries(otherSeasons)) if (team !== targetTeamId) for (const ref of Object.values(slots)) if (ref) seen.add(ref.player_id);
  for (const role of ROSTER_ROLES) {
    const ref = refs[role]; if (!ref) continue;
    resolveSeasonRef(ref, role, catalog);
    if (current[targetTeamId]?.[role]) throw new Error("시즌 선수와 현재 선수를 같은 자리에 함께 넣을 수 없습니다.");
    if (seen.has(ref.player_id)) throw new Error("이미 다른 자리에 있는 선수입니다. 같은 선수의 다른 시즌도 동시에 배정하지 않습니다.");
    seen.add(ref.player_id);
  }
}
