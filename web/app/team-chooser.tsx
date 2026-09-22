"use client";

import { useId, useRef, useState } from "react";
import type { OpponentTeam } from "./radar-types";
import "./app-navigation.css";

const primaryLeagues = ["LCK", "LPL", "LEC", "LCS", "LCP"];
const normalized = (value: string) => value.normalize("NFKD").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]/gu, "");

export function teamChoices(teams: OpponentTeam[], query: string, league: string) {
  const terms = query.trim().split(/\s+/).map(normalized).filter(Boolean);
  return teams.filter((team) => (league === "ALL" || team.leagues.includes(league)) &&
    terms.every((term) => [team.team_name, ...team.team_name_aliases, ...team.leagues].some((name) => normalized(name).includes(term))))
    .sort((a, b) => a.team_name.localeCompare(b.team_name, "ko-KR") || a.team_id.localeCompare(b.team_id));
}

export function TeamChooser({ label, teams, value, onChange, disabled = false, allowClear = false }: {
  label: string; teams: OpponentTeam[]; value: string; onChange: (id: string) => void; disabled?: boolean; allowClear?: boolean;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [league, setLeague] = useState("ALL");
  const [limit, setLimit] = useState(24);
  const selected = teams.find((team) => team.team_id === value);
  const leagues = Array.from(new Set(teams.flatMap((team) => team.leagues))).sort();
  const otherLeagues = leagues.filter((item) => !primaryLeagues.includes(item));
  const results = teamChoices(teams, query, league);

  function open() {
    setQuery(""); setLimit(24);
    setLeague(selected?.leagues[0] ?? (leagues.includes("LCK") ? "LCK" : "ALL"));
    dialog.current?.showModal(); search.current?.focus();
  }
  function choose(id: string) {
    if (disabled) return;
    onChange(id); dialog.current?.close();
  }
  return <div className="team-chooser">
    <button className="team-chooser-trigger" type="button" disabled={disabled} onClick={open} aria-haspopup="dialog" aria-label={`${label}: ${selected?.team_name ?? "팀 고르기"}`}>
      <span><small>{label}</small><strong>{selected?.team_name ?? "팀 고르기"}</strong><em>{selected ? selected.leagues.join(" · ") : "리그별로 찾거나 이름 검색"}</em></span><b aria-hidden="true">변경 ›</b>
    </button>
    <dialog ref={dialog} className="team-chooser-sheet" aria-labelledby={`${id}-title`}>
      <header><div><small>TEAM SELECT</small><h2 id={`${id}-title`}>{label}</h2></div><button type="button" onClick={() => dialog.current?.close()} aria-label={`${label} 닫기`}>닫기</button></header>
      <label className="team-chooser-search">팀 이름 검색<input ref={search} type="search" value={query} placeholder="팀명·별칭·리그 검색" onChange={(event) => { setQuery(event.target.value); setLimit(24); }} /></label>
      <div className="team-league-chips" aria-label="리그 필터">{[...primaryLeagues.filter((item) => leagues.includes(item)), "ALL"].map((item) => <button type="button" key={item} aria-pressed={league === item} onClick={() => { setLeague(item); setLimit(24); }}>{item === "ALL" ? "전체" : item}</button>)}</div>
      {otherLeagues.length > 0 && <label className="team-other-league">다른 리그<select value={otherLeagues.includes(league) ? league : ""} onChange={(event) => { if (event.target.value) { setLeague(event.target.value); setLimit(24); } }}><option value="">리그 선택</option>{otherLeagues.map((item) => <option key={item}>{item}</option>)}</select></label>}
      <p className="team-choice-count" role="status">{league === "ALL" ? "전체 리그" : league} · {results.length}개 팀{selected ? ` · 현재 ${selected.team_name}` : ""}</p>
      <div className="team-choice-grid">{results.slice(0, limit).map((team) => <button type="button" key={team.team_id} aria-pressed={team.team_id === value} onClick={() => choose(team.team_id)}><span>{team.leagues.join(" · ")}{team.team_id === value ? " · 선택됨" : ""}</span><strong>{team.team_name}</strong><small>공개 표본 {team.game_count}경기</small></button>)}</div>
      {!results.length && <div className="team-choice-empty"><p>이 조건에 맞는 팀이 없습니다.</p><button type="button" onClick={() => { setLeague("ALL"); setQuery(""); setLimit(24); }}>전체 팀에서 다시 찾기</button></div>}
      <footer>{results.length > limit && <button type="button" onClick={() => setLimit((count) => count + 24)}>24개 더 보기</button>}{allowClear && selected && <button type="button" onClick={() => choose("")}>내 팀 선택 해제</button>}</footer>
    </dialog>
  </div>;
}
