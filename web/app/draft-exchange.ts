import { championAssetId } from "./champion-assets";
import { isChampionLocked, nextDraftTurn, type DraftSelection, type DraftSide } from "./draft-agent";
import type { DraftScoutPack } from "./draft-scout";

export type PreparedPick = { role: string; champion_id: string };
const key = (id: string) => championAssetId(id).toLowerCase();

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
  const ownPool = pack.own.player_pools.find((group) => group.role === focus.role);
  const ownCandidates = (omitFocus: boolean) => (ownPool?.champions ?? [])
    .filter((c) => !unavailable(c.champion_id) && (!omitFocus || key(c.champion_id) !== key(focus.champion_id)))
    .filter((c) => ready(focus.role, c.champion_id)).slice(0, 3);
  const opponentCandidates = (omitFocus: boolean) => (pool?.champions ?? [])
    .filter((c) => !unavailable(c.champion_id) && (!omitFocus || key(c.champion_id) !== key(focus.champion_id))).slice(0, 3);
  const available = Boolean(observedFocus) && !unavailable(focus.champion_id);
  const ourTurn = turn?.side === context.ownSide;
  const canSecure = Boolean(ownPool?.champions.some((c) => key(c.champion_id) === key(focus.champion_id))) && ready(focus.role, focus.champion_id);
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
    ],
  };
}
