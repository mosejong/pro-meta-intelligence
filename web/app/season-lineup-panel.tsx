"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useChampionNames } from "./champion-names";
import { fetchJsonWithTimeout } from "./publication-loader";
import { emptySeasonSlots, parseSeasonCardCatalog, verifySeasonCardIntegrity, resolveSeasonRef, type SeasonCardCatalog, type SeasonCardRef, type SeasonSlots, type TeamSeasonSlots } from "./season-player-cards";
import { observedSeasonTeams, presetBlockReason, seasonPresetSlots } from "./season-team-preset";
import { ROSTER_ROLES, type RosterRole } from "./roster-scenario";
const roles: Record<RosterRole, string> = { TOP: "탑", JUNGLE: "정글", MID: "미드", BOTTOM: "바텀", SUPPORT: "서포터" };
export function SeasonLineupPanel({ catalog, onCatalog, lineups, teams, publicationRoot, disabled, onChoose, onApplyPreset }: {
  catalog: SeasonCardCatalog | null; onCatalog: (c: SeasonCardCatalog) => void; lineups: TeamSeasonSlots; teams: { id: string; name: string; side: string }[]; publicationRoot: string; disabled: boolean;
  onChoose: (teamId: string, role: RosterRole, ref: SeasonCardRef | null) => void;
  onApplyPreset: (teamId: string, slots: SeasonSlots) => void;
}) {
  const { nameOf } = useChampionNames();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [year, setYear] = useState(2022), [query, setQuery] = useState("");
  const [presetKey, setPresetKey] = useState("");
  const presetTeams = useMemo(() => catalog ? observedSeasonTeams(catalog, year) : [], [catalog, year]);
  const preset = presetTeams.find(t => t.key === presetKey) ?? null;
  const presetBlocked = preset ? presetBlockReason(preset) : null;
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function load() {
    request.current?.abort(); const controller = new AbortController(); request.current = controller; setBusy(true); setMessage("");
    try {
      const url = new URL(`${publicationRoot.endsWith("/") ? publicationRoot : publicationRoot + "/"}history/season-player-cards.json`, window.location.href);
      const data = await fetchJsonWithTimeout(url, { signal: controller.signal, timeoutMs: 15000 });
      const parsed = parseSeasonCardCatalog(data);
      await verifySeasonCardIntegrity(parsed);
      if (!controller.signal.aborted) { onCatalog(parsed); if (!parsed.cards.some(c => c.season === year)) setYear(parsed.cards[0]?.season ?? 2022); }
    } catch { if (!controller.signal.aborted) setMessage("시즌 선수 자료를 불러오지 못했습니다. 현재 구단과 선수 구성은 유지합니다."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <details className="season-lineup" lang="ko">
    <summary>과거 시즌 선수로 구성하기</summary>
    <p>2014년 이후 자료를 순차 확보 중이며, 연도·대회별 수집 범위와 누락이 있을 수 있습니다. 시즌 선수는 내 구단에 저장하거나 밴픽과 함께 내 연습 보관함에 저장할 수 있으며, 현재 선수 자리와 구분합니다. 아직 밴픽 추천·A/B의 선수 효과·시뮬레이션에는 연결하지 않습니다.</p>
    {!catalog && <button type="button" disabled={busy || disabled} onClick={() => void load()}>{busy ? "시즌 자료 확인 중" : "시즌 선수 자료 불러오기"}</button>}
    {message && <p role="alert">{message}</p>}
    {catalog && <>
      <p>선수 기록 기준 {catalog.cutoff.slice(0, 10)} · 사용 횟수는 당시 관측이며 현재 숙련도가 아닙니다. 선수 구성만 보관하려면 위의 구단 저장을, 밴픽과 함께 보관하려면 내 연습 보관함을 이용하세요.</p>
      <div className="guest-club-fields">
        <label>선수 시즌<select aria-label="선수 시즌" value={year} onChange={e => setYear(Number(e.target.value))}>{catalog.seasons.map(y => <option key={y.season} value={y.season} disabled={y.status !== "LOADED"}>{y.season}{y.status === "NOT_LOADED" ? " · 자료 미확보" : ""}</option>)}</select></label>
        <label>시즌 선수 검색<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Nuguri, Faker…" /></label>
        <label>관측 팀<select aria-label="관측 팀" value={preset ? preset.key : ""} onChange={e => setPresetKey(e.target.value)}><option value="">팀 선택 안 함</option>{presetTeams.map(t => <option key={t.key} value={t.key}>{t.season} {t.team_names.join(" / ")}{t.status === "READY" ? "" : " · 직접 선택 필요"}</option>)}</select></label>
      </div>
      {preset && <div role="group" aria-label="역할별 최다 출전 구성">
        <p><strong>역할별 최다 출전 구성</strong> · {preset.season} {preset.team_names.join(" / ")}<br />
          {ROSTER_ROLES.map(role => { const c = preset.picks[role]; return `${roles[role]} ${c ? `${c.player_name} ${c.game_count}경기` : "—"}`; }).join(" · ")}<br />
          <small>당시 출전 수 기준이며 공식 선발·강함을 뜻하지 않습니다.</small></p>
        {presetBlocked && <p role="alert">{presetBlocked}</p>}
        {teams.map(team => <button key={team.id} type="button" disabled={disabled || !!presetBlocked} onClick={() => {
          if (!catalog) return;
          const result = seasonPresetSlots(preset, catalog);
          if (result.ok) { setMessage(""); onApplyPreset(team.id, result.slots); } else setMessage(result.error);
        }}>{team.side}에 적용</button>)}
        <small> 적용하면 해당 팀의 현재 선수 5자리를 이 구성으로 대체합니다.</small>
      </div>}
      <div className="roster-workshop-teams">{teams.map(team => <section key={team.id} aria-label={`${team.side} 시즌 라인업`}>
        <h4>{team.side} · {team.name}</h4>
        {ROSTER_ROLES.map(role => {
          const ref = (lineups[team.id] ?? emptySeasonSlots())[role];
          let selected = null;
          try { if (ref) selected = resolveSeasonRef(ref, role, catalog); } catch { /* Retained references remain visible as unavailable. */ }
          const choices = catalog.cards.filter(c => c.season === year && c.role === role && `${c.player_name} ${c.team_names.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => a.player_name.localeCompare(b.player_name) || a.id.localeCompare(b.id));
          if (selected && !choices.some(c => c.id === selected.id)) choices.unshift(selected);
          return <div className="season-lineup-role" key={role}>
            <label>{roles[role]}<select aria-label={`${team.side} ${roles[role]} 시즌 선수`} value={ref?.card_id ?? ""} disabled={disabled} onChange={e => {
              const card = catalog.cards.find(c => c.id === e.target.value);
              onChoose(team.id, role, card ? { catalog_id: catalog.catalog_id, card_id: card.id, player_id: card.player_id } : null);
            }}><option value="">시즌 선수 미지정</option>{choices.map(c => <option key={c.id} value={c.id}>{c.season} {c.player_name} · {c.team_names.join(" / ")} · {c.game_count}경기</option>)}</select></label>
            {selected && <p><strong>{selected.season} {selected.player_name}</strong> · {selected.game_count}경기<br />{[...selected.champions].sort((a, b) => b.games - a.games || a.champion_id.localeCompare(b.champion_id)).slice(0, 5).map(c => `${nameOf(c.champion_id)} ${c.games}회`).join(" · ")}<br /><small>선택 당시 역할 {roles[selected.role]} · 출처 OE · 과거 원본 팀 표기입니다.</small></p>}
            {ref && !selected && <p role="alert">저장된 시즌 선수를 확인하지 못했습니다. 현재 선수로 대체하지 않습니다.</p>}
          </div>;
        })}
      </section>)}</div>
      <p>시즌 선수를 배정하면 해당 현재 선수 슬롯은 비웁니다. 시즌 선정을 해제해도 이전 선수를 자동 복원하지 않습니다.</p>
    </>}
  </details>;
}
