import { useState } from "react";
import { compareDraftExchange, ownPreparationOptions, type PreparedPick } from "./draft-exchange";
import type { DraftScoutPack } from "./draft-scout";
import { isChampionLocked, type DraftSelection, type DraftSide } from "./draft-agent";

const labels = { BAN: "밴으로 제거", OPEN: "열고 교환 검토", SECURE: "우리가 먼저 확보" };
const roleNames: Record<string, string> = { TOP: "탑", JUNGLE: "정글", MID: "미드", BOTTOM: "바텀", SUPPORT: "서포터" };

export function DraftExchangePanel({ pack, selections, previousPicks, ownSide, firstPickSide, nameOf }: {
  pack: DraftScoutPack; selections: DraftSelection[]; previousPicks: string[];
  ownSide: DraftSide; firstPickSide: DraftSide; nameOf: (id: string) => string;
}) {
  const options = pack.levers.expected_picks.flatMap((group) => group.champions.map((c) => ({ role: group.role, champion_id: c.champion_id })));
  const [selected, setSelected] = useState("");
  const [prepared, setPrepared] = useState<PreparedPick[]>([]);
  const token = (c: PreparedPick) => `${c.role}:${c.champion_id}`;
  const focus = options.find((c) => token(c) === selected) ?? options[0];
  if (!focus) return null;
  const result = compareDraftExchange(pack, focus, { selections, previousPicks, ownSide, firstPickSide, prepared });
  const preparationOptions = ownPreparationOptions(pack);
  const preparationRoles = [...new Set(preparationOptions.map((c) => c.role))];
  const describeOwnCard = (card: PreparedPick & { committed: boolean; rolePrepared: boolean }) =>
    `${nameOf(card.champion_id)} (${roleNames[card.role] ?? card.role} 기록 · ${card.committed ? "챔피언 픽 확정 · " : ""}${card.rolePrepared ? "해당 역할 준비 확인" : "해당 역할 준비 미확인"})`;
  return <section aria-label="밴픽 교환 시나리오">
    <h3>밴·오픈·선점 비교</h3>
    <p>상대 후속 후보와 우리가 준비한 카드를 비교합니다. 조합 상성이나 최종 확보를 예측하지 않으며 드래프트를 자동 확정하지 않습니다.</p>
    <label>검토할 상대 카드 <select value={token(focus)} onChange={(e) => setSelected(e.target.value)}>
      {options.map((c) => <option key={token(c)} value={token(c)}>{roleNames[c.role] ?? c.role} · {nameOf(c.champion_id)}</option>)}
    </select></label>
    {preparationRoles.map((role) => <fieldset key={role}><legend>우리 {roleNames[role] ?? role} 준비 확인 · {pack.own.player_pools.find((pool) => pool.role === role)?.player_name ?? "선수 미상"}</legend>
      <p>직접 준비됐다고 확인한 카드만 아래 대응 후보에 표시합니다. 페이지를 다시 열거나 상대를 바꾸면 입력은 초기화됩니다. 공개 기록만으로 준비도를 채우지 않습니다. 사용 불가 표시는 이번 세트에서 이미 밴·픽됐거나 이전 세트에서 쓴 카드입니다.</p>
      <p>공개 선수 풀과 우리 팀의 실제 동시 사용 기록에 있는 역할별 카드입니다. 픽 확정만으로 해당 역할 준비를 확인하지 않습니다.</p>
      {preparationOptions.filter((c) => c.role === role).map((item) => {
        const checked = prepared.some((p) => token(p) === token(item));
        const locked = isChampionLocked(selections, item.champion_id, previousPicks);
        return <label key={token(item)} data-locked={locked ? "true" : undefined} style={{ display: "inline-block", margin: "0.3rem" }}><input type="checkbox" checked={checked} onChange={() => setPrepared((rows) => checked ? rows.filter((p) => token(p) !== token(item)) : [...rows, item])} />{nameOf(item.champion_id)}{locked && <em> · 사용 불가 · 확정 밴픽/이전 픽</em>}</label>;
      })}
    </fieldset>)}
    {!result.available && <p role="status">이 카드는 이미 사용 불가하거나 현재 후보 근거가 없습니다. 다른 카드를 선택하세요.</p>}
    <div className="draft-scout-leagues">{result.branches.map((branch) => <article key={branch.action}>
      <h4>{labels[branch.action]}</h4><p>{branch.cost}</p>
      <p>{branch.legalNow ? "현재 우리 차례에 가능한 행동" : "가정 비교 · 현재 즉시 실행 가능한 행동으로 확인되지 않음"}</p>
      <p>{branch.action === "OPEN" ? "상대가 가져간다고 가정한 카드" : "상대에게 남는 같은 역할 후보"}: {branch.opponent.map((c) => nameOf(c.champion_id)).join(" · ") || "근거 없음"}</p>
      <p>우리 준비 카드: {branch.own.map((c) => nameOf(c.champion_id)).join(" · ") || "준비 확인된 가용 카드 없음"}</p>
      <p>상대의 실제 동시 사용 조합: {branch.opponentPairs.map((pair) => `${nameOf(pair.left.champion_id)} + ${nameOf(pair.right.champion_id)} (${pair.game_count}경기)`).join(" · ") || "현재 조건에 맞는 근거 없음"}</p>
      <p>우리 확정 픽·역할별 준비와 연결된 동시 사용 기록: {branch.ownPairs.map((pair) => `${describeOwnCard(pair.left)} + ${describeOwnCard(pair.right)} (${pair.game_count}경기)`).join(" · ") || "준비 확인 또는 조합 근거 부족"}</p>
    </article>)}</div>
    <p>조합 표시는 최근 표본에서 함께 사용한 두 챔피언의 기록입니다. 상대 조합을 이기는 카운터나 전체 조합 완성을 뜻하지 않습니다. 역할 배정과 이어지는 상대 밴은 추론하지 않습니다.</p>
  </section>;
}
