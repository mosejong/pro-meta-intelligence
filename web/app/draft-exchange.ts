import { championAssetId } from "./champion-assets";
import { isChampionLocked, nextDraftTurn, type DraftSelection, type DraftSide } from "./draft-agent";
import type { DraftScoutPack } from "./draft-scout";

export type PreparedPick = { role: string; champion_id: string };
const key = (id: string) => championAssetId(id).toLowerCase();

// Pair evidence can extend a truncated pool, but never invent a champion's role.
export function ownPreparationOptions(pack: DraftScoutPack): PreparedPick[] {
  const options = new Map<string, PreparedPick>();
  const add = (card: PreparedPick) => options.set(`${card.role}:${key(card.champion_id)}`, { role: card.role, champion_id: card.champion_id });
  for (const pool of pack.own.player_pools) for (const card of pool.champions) add({ ...card, role: pool.role });
  for (const pair of pack.own.observed_pairs ?? []) {
    if (pair.game_count > 0 && pair.evidence_match_ids.length > 0) {
      add(pair.left);
      add(pair.right);
    }
  }
  return [...options.values()];
}

// A bounded comparison of available observed cards, not a composition/win-probability model.
export function compareDraftExchange(pack: DraftScoutPack, focus: PreparedPick, context: {
  selections: DraftSelection[]; previousPicks: string[]; ownSide: DraftSide;
  firstPickSide: DraftSide; prepared: PreparedPick[];
}) {
  const turn = nextDraftTurn(context.selections, context.firstPickSide);
  const unavailable = (id: string) => isChampionLocked(context.selections, id, context.previousPicks);
  const pool = pack.levers.expected_picks.find((group) => group.role === focus.role);
  const observedFocus = pool?.champions.find((c) => key(c.champion_id) === key(focus.champion_id));
  const ready = (role: string, id: string) => context.prepared.some((c) => c.role === role && key(c.champion_id) === key(id));
  const ownOptions = ownPreparationOptions(pack).filter((c) => c.role === focus.role);
  const ownCandidates = (omitFocus: boolean) => ownOptions
    .filter((c) => !unavailable(c.champion_id) && (!omitFocus || key(c.champion_id) !== key(focus.champion_id)))
    .filter((c) => ready(focus.role, c.champion_id)).slice(0, 3);
  const opponentCandidates = (omitFocus: boolean) => (pool?.champions ?? [])
    .filter((c) => !unavailable(c.champion_id) && (!omitFocus || key(c.champion_id) !== key(focus.champion_id))).slice(0, 3);
  const available = Boolean(observedFocus) && !unavailable(focus.champion_id);
  const ourTurn = turn?.side === context.ownSide;
  const canSecure = ownOptions.some((c) => key(c.champion_id) === key(focus.champion_id)) && ready(focus.role, focus.champion_id);
  const ownPicked = context.selections.filter((s) => s.kind === "PICK" && s.side === context.ownSide).map((s) => s.champion_id);
  const opponentPicked = context.selections.filter((s) => s.kind === "PICK" && s.side !== context.ownSide).map((s) => s.champion_id);
  const observedPairs = (team: DraftScoutPack["target"], anchors: string[], excluded: string[], own: boolean) => {
    const anchorKeys = new Set(anchors.map(key));
    const blocked = new Set(excluded.map(key));
    const picked = new Set((own ? ownPicked : opponentPicked).map(key));
    return (team.observed_pairs ?? []).filter((pair) => {
      const cards = [pair.left, pair.right];
      return cards.some((c) => anchorKeys.has(key(c.champion_id))) && cards.every((c) =>
        !blocked.has(key(c.champion_id)) && (!unavailable(c.champion_id) || picked.has(key(c.champion_id))) &&
        (!own || picked.has(key(c.champion_id)) || ready(c.role, c.champion_id)));
    }).slice(0, 3).map((pair) => ({ ...pair,
      left: { ...pair.left, committed: picked.has(key(pair.left.champion_id)), rolePrepared: own && ready(pair.left.role, pair.left.champion_id) },
      right: { ...pair.right, committed: picked.has(key(pair.right.champion_id)), rolePrepared: own && ready(pair.right.role, pair.right.champion_id) },
    }));
  };
  return {
    focus, available, turn,
    // OPEN never commits an action; it is a planning alternative, not a draft operation.
    branches: [
      { action: "BAN" as const, legalNow: available && ourTurn && turn?.kind === "BAN",
        opponent: opponentCandidates(true), own: ownCandidates(true),
        cost: "밴 1장 사용 · 양 팀 모두 해당 챔피언을 사용할 수 없음" },
      { action: "OPEN" as const, legalNow: false,
        opponent: available && observedFocus ? [observedFocus] : [], own: ownCandidates(true),
        cost: "밴을 다른 카드에 사용 · 상대가 해당 카드를 가져간다고 가정해 우리 대안에서 제외" },
      { action: "SECURE" as const, legalNow: available && ourTurn && turn?.kind === "PICK" && canSecure,
        opponent: opponentCandidates(true), own: canSecure && available ? [{ champion_id: focus.champion_id }] : [],
        cost: "우리 픽 1자리 사용 · 같은 역할 공개 기록과 준비 확인이 모두 필요" },
    ].map((branch) => ({ ...branch,
      opponentPairs: observedPairs(pack.target, [...opponentPicked, ...(branch.action === "OPEN" && available ? [focus.champion_id] : [])],
        branch.action === "OPEN" ? [] : [focus.champion_id], false),
      ownPairs: observedPairs(pack.own, [...ownPicked, ...branch.own.map((c) => c.champion_id)],
        branch.action === "SECURE" ? [] : [focus.champion_id], true),
    })),
  };
}
