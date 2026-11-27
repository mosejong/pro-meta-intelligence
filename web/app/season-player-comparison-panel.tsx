"use client";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { PoolSelection } from "./player-pool-evidence";
import { ROSTER_ROLES, type RosterRole } from "./roster-scenario";
import { emptySeasonSlots, resolveSeasonRef, type SeasonCard, type SeasonCardCatalog, type TeamSeasonSlots } from "./season-player-cards";
import { compareSeasonCards, seasonComparisonReasonLabel, type SeasonComparisonRow, type SeasonComparisonSide } from "./season-player-comparison";
import { seasonPoolStateLabel } from "./season-pool-context";
import { seasonChampionDetail, type SeasonChampionTarget } from "./season-champion-detail";
import { SeasonChampionDetailView, type SeasonChampionAnalysis } from "./season-champion-detail-panel";
import "./season-player-comparison.css";

const roles: Record<RosterRole, string> = { TOP: "탑", JUNGLE: "정글", MID: "미드", BOTTOM: "바텀", SUPPORT: "서포터" };

/**
 * Read-only comparison of observed champion records for past-season cards assigned to the same role on both sides.
 * Each listed champion opens an in-panel, read-only detail (season observation vs. current publication) that is
 * withdrawn when the catalog or either compared card changes; it never stages or confirms a draft selection.
 */
export function SeasonPlayerComparisonPanel({ catalog, lineups, teams, selections, previousPicks, nameOf, analysis = null }: {
  catalog: SeasonCardCatalog | null; lineups: TeamSeasonSlots; teams: readonly { id: string; name: string; side: string }[];
  selections: readonly PoolSelection[]; previousPicks: readonly string[]; nameOf: (championId: string) => string;
  /** Current publication for the detail's "현재 발행본" half; omitted = shown as not connected. */
  analysis?: SeasonChampionAnalysis | null;
}) {
  const [target, setTarget] = useState<SeasonChampionTarget | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const summaryRef = useRef<HTMLElement | null>(null);
  const detail = seasonChampionDetail(target, catalog, lineups, selections, previousPicks);
  const stale = !!target && !detail;
  const [withdrawn, setWithdrawn] = useState(0);
  // Catalog or compared-card change: withdraw the old detail for good (it never reappears if the same
  // cards come back), then let focus fall back to the panel summary if it was lost with the detail.
  if (stale) { setTarget(null); setWithdrawn((count) => count + 1); }
  useEffect(() => {
    if (withdrawn && (!document.activeElement || document.activeElement === document.body)) summaryRef.current?.focus();
  }, [withdrawn]);
  const openKey = detail ? `${detail.role}|${detail.champion_id}` : "";
  useEffect(() => { if (openKey) heading.current?.focus(); }, [openKey]);
  function close() {
    setTarget(null);
    const back = trigger.current; trigger.current = null;
    if (back?.isConnected) back.focus(); else summaryRef.current?.focus();
  }
  if (!catalog) return null;
  const anyRef = Object.values(lineups).some(slots => slots && Object.values(slots).some(Boolean));
  if (!anyRef) return null;
  const blues = teams.filter(t => t.side === "BLUE"), reds = teams.filter(t => t.side === "RED");
  const body = (() => {
    if (blues.length !== 1 || reds.length !== 1) return <p>블루와 레드 팀이 각각 하나씩 있어야 시즌 선수 관측을 비교할 수 있습니다.</p>;
    const [blue, red] = [blues[0], reds[0]];
    const blueSlots = lineups[blue.id] ?? emptySeasonSlots(), redSlots = lineups[red.id] ?? emptySeasonSlots();
    const resolve = (ref: Parameters<typeof resolveSeasonRef>[0], role: RosterRole): SeasonCard | null => { try { return resolveSeasonRef(ref, role, catalog); } catch { return null; } };
    const rows = ROSTER_ROLES.flatMap(role => {
      const bRef = blueSlots[role], rRef = redSlots[role];
      if (!bRef && !rRef) return [];
      const head = <h4>{roles[role]}</h4>;
      if (!bRef || !rRef) return [<li key={role} className="season-compare-card">{head}<p>{`${bRef ? "레드" : "블루"} ${roles[role]}에도 시즌 선수를 배정하면 관측 기록을 비교할 수 있습니다.`}</p></li>];
      const bCard = resolve(bRef, role), rCard = resolve(rRef, role);
      if (!bCard || !rCard) return [<li key={role} className="season-compare-card">{head}<p role="alert">{!bCard ? "블루" : "레드"} 시즌 선수를 자료에서 확인하지 못해 이 역할은 미확인으로 둡니다. 다른 선수로 대체하지 않습니다.</p></li>];
      const result = compareSeasonCards(bCard, rCard, selections, previousPicks);
      if (!result.ok) return [<li key={role} className="season-compare-card">{head}<p role="alert">{seasonComparisonReasonLabel[result.reason]}</p></li>];
      const open = (championId: string) => (event: MouseEvent<HTMLButtonElement>) => {
        trigger.current = event.currentTarget;
        setTarget({ catalog_id: catalog.catalog_id, role, champion_id: championId, blue: { team_id: blue.id, card_id: bCard.id }, red: { team_id: red.id, card_id: rCard.id } });
      };
      const current = detail && detail.role === role ? detail : null;
      const champ = (championId: string, where: string) => <button type="button" className="season-compare-champ" aria-expanded={current?.champion_id === championId}
        aria-label={`${nameOf(championId)} 상세 보기 (${roles[role]} ${where})`} onClick={open(championId)}>{nameOf(championId)}</button>;
      const row = (r: SeasonComparisonRow) => <li key={r.champion_id}>{champ(r.champion_id, "시즌 관측")} {r.games}회 <small>({seasonPoolStateLabel[r.state]})</small></li>;
      const side = (label: string, teamName: string, s: SeasonComparisonSide) => <div className="season-compare-side">
        <strong>{label} · {teamName}</strong>
        <span>{s.season} {s.player_name} · {s.team_names.join(" / ")} · {s.game_count}경기</span>
        <span>많이 사용</span>
        <ol>{s.top.map(row)}</ol>
        <span>이쪽에서만 관측 {s.only_count}개</span>
        {s.only.length ? <ol>{s.only.map(row)}</ol> : <small>없음</small>}
        <small>패치 {s.patches.join(", ")} · 출처 {s.source_id === "oracles-elixir-match-data" ? "Oracle’s Elixir" : "미확인"}</small>
      </div>;
      return [<li key={role} className="season-compare-card">{head}
        <div className="season-compare-sides">{side("블루", blue.name, result.blue)}{side("레드", red.name, result.red)}</div>
        <div><span>양쪽 모두 관측 {result.common_count}개{result.common_count > result.common.length ? ` (${result.common.length}개 표시)` : ""}</span>
          {result.common.length ? <ul>{result.common.map(c => <li key={c.key}>{champ(c.blue_champion_id, "양쪽 관측")} · 블루 {c.blue_games}회 · 레드 {c.red_games}회 <small>({seasonPoolStateLabel[c.state]})</small></li>)}</ul> : <small> 공통 관측 챔피언 없음</small>}
        </div>
        {current && <SeasonChampionDetailView detail={current} analysis={analysis} nameOf={nameOf} onClose={close} headingRef={heading} />}
      </li>];
    });
    return rows.length ? <ul className="season-compare-rows">{rows}</ul> : null;
  })();
  return <details className="season-compare" lang="ko">
    <summary ref={summaryRef}>시즌 선수 관측 비교</summary>
    <div className="season-compare-body">
      <p><small>선수 기록 기준 {catalog.cutoff.slice(0, 10)} · 당시 관측 사용 횟수이며 승패·능력·우열이나 현재 메타 추천이 아닙니다. 한쪽에만 있는 챔피언은 상대 쪽 미관측이며 0회가 아닙니다.</small></p>
      <p><small>같은 챔피언 ID여도 리워크·시대 차이가 있을 수 있고, 두 선수의 관측 기간과 표본 수가 다릅니다.</small></p>
      <p><small>챔피언 이름을 누르면 시즌 관측과 현재 발행본 분석을 나눠 봅니다. 밴픽 선택은 바뀌지 않습니다.</small></p>
      {body}
    </div>
  </details>;
}
