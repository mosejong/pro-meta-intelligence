import type { GuestClub } from "./guest-club";
import { ROSTER_ROLES } from "./roster-scenario";
import { resolveSeasonRef, type SeasonCard, type SeasonCardCatalog, type SeasonSlots } from "./season-player-cards";

const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const canonical = (x: unknown): unknown => Array.isArray(x) ? x.map(canonical) : object(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
const sameCard = (a: SeasonCard, b: SeasonCard) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/**
 * The single catalog_id every saved season reference points to, or null when the club has none.
 * References from more than one catalog version are refused rather than partly converted.
 */
export function savedSeasonCatalogId(club: GuestClub): string | null {
  const ids = new Set<string>();
  for (const role of ROSTER_ROLES) { const ref = club.seasonSlots?.[role]; if (ref) ids.add(ref.catalog_id); }
  if (ids.size > 1) throw new Error("저장된 시즌 선수가 서로 다른 자료 버전을 섞어 쓰고 있어 불러오지 않았습니다. 기존 로스터를 유지합니다.");
  return ids.size ? [...ids][0] : null;
}

/**
 * Return a detached copy of `club` whose season references point at `current`, but only when every
 * referenced card resolves in `saved` (exact id, player and role) and the same card in `current` is
 * byte-for-byte identical after sorted-key canonicalisation (name, team, games, champion counts,
 * patches and source_hashes included). Anything else throws; the input club is never mutated.
 * A club already on `current` is returned as an unchanged copy. No match effects are added.
 */
export function migrateClubSeasonSlots(club: GuestClub, saved: SeasonCardCatalog | null, current: SeasonCardCatalog): GuestClub {
  const copy = structuredClone(club);
  const savedId = savedSeasonCatalogId(club);
  if (savedId === null || savedId === current.catalog_id) return copy;
  if (!saved || saved.catalog_id !== savedId) throw new Error("저장 당시 시즌 선수 자료를 확인하지 못해 불러오지 않았습니다. 기존 로스터를 유지합니다.");
  const next = {} as SeasonSlots;
  for (const role of ROSTER_ROLES) {
    const ref = club.seasonSlots?.[role] ?? null;
    if (!ref) { next[role] = null; continue; }
    const before = resolveSeasonRef(ref, role, saved);
    const now = current.cards.find(c => c.id === ref.card_id);
    if (!now || now.player_id !== ref.player_id || now.role !== role) throw new Error(`${before.season} ${before.player_name} 카드를 현재 시즌 선수 자료에서 같은 자리로 찾지 못해 불러오지 않았습니다. 기존 로스터를 유지합니다.`);
    if (!sameCard(before, now)) throw new Error(`${before.season} ${before.player_name} 카드 내용이 현재 자료와 달라 불러오지 않았습니다. 저장된 구단은 그대로 보관됩니다.`);
    next[role] = { catalog_id: current.catalog_id, card_id: ref.card_id, player_id: ref.player_id };
  }
  copy.seasonSlots = next;
  return copy;
}
