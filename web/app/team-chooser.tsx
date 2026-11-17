"use client";

import { useId, useRef, useState } from "react";
import type { OpponentTeam } from "./radar-types";
import { DEFAULT_LOCALE, messagesFor, type Locale } from "./locale";
import "./app-navigation.css";

const primaryLeagues = ["LCK", "LPL", "LEC", "LCS", "LCP"];
const PAGE_SIZE = 24;
const normalized = (value: string) => value.normalize("NFKD").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]/gu, "");

export function teamChoices(teams: OpponentTeam[], query: string, league: string) {
  const terms = query.trim().split(/\s+/).map(normalized).filter(Boolean);
  return teams.filter((team) => (league === "ALL" || team.leagues.includes(league)) &&
    terms.every((term) => [team.team_name, ...team.team_name_aliases, ...team.leagues].some((name) => normalized(name).includes(term))))
    .sort((a, b) => a.team_name.localeCompare(b.team_name, "ko-KR") || a.team_id.localeCompare(b.team_id));
}

/**
 * `locale` is explicit, not read from context: callers whose surrounding copy (and `label`) is
 * still Korean-only keep a fully Korean chooser, so no single control mixes languages.
 * The root carries `lang` so assistive tech reads the chooser in its actual language.
 */
export function TeamChooser({ label, teams, value, onChange, disabled = false, allowClear = false, locale = DEFAULT_LOCALE }: {
  label: string; teams: OpponentTeam[]; value: string; onChange: (id: string) => void; disabled?: boolean; allowClear?: boolean; locale?: Locale;
}) {
  const { t, format } = messagesFor(locale);
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [league, setLeague] = useState("ALL");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const selected = teams.find((team) => team.team_id === value);
  const leagues = Array.from(new Set(teams.flatMap((team) => team.leagues))).sort();
  const otherLeagues = leagues.filter((item) => !primaryLeagues.includes(item));
  const results = teamChoices(teams, query, league);

  function open() {
    setQuery(""); setLimit(PAGE_SIZE);
    setLeague(selected?.leagues[0] ?? (leagues.includes("LCK") ? "LCK" : "ALL"));
    dialog.current?.showModal(); search.current?.focus();
  }
  function choose(id: string) {
    if (disabled) return;
    onChange(id); dialog.current?.close();
  }
  const pickLabel = selected?.team_name ?? t("team.pick");
  const leagueLabel = league === "ALL" ? t("team.allLeagues") : league;
  return <div className="team-chooser" lang={locale}>
    <button className="team-chooser-trigger" type="button" disabled={disabled} onClick={open} aria-haspopup="dialog" aria-label={`${label}: ${pickLabel}`}>
      <span><small>{label}</small><strong>{pickLabel}</strong><em>{selected ? selected.leagues.join(" · ") : t("team.hint")}</em></span><b aria-hidden="true">{t("team.change")}</b>
    </button>
    <dialog ref={dialog} className="team-chooser-sheet" aria-labelledby={`${id}-title`}>
      <header><div><small>TEAM SELECT</small><h2 id={`${id}-title`}>{label}</h2></div><button type="button" onClick={() => dialog.current?.close()} aria-label={format("team.closeLabel", { label })}>{t("team.close")}</button></header>
      <label className="team-chooser-search">{t("team.search")}<input ref={search} type="search" value={query} placeholder={t("team.searchPlaceholder")} onChange={(event) => { setQuery(event.target.value); setLimit(PAGE_SIZE); }} /></label>
      <div className="team-league-chips" aria-label={t("team.leagueFilter")}>{[...primaryLeagues.filter((item) => leagues.includes(item)), "ALL"].map((item) => <button type="button" key={item} aria-pressed={league === item} onClick={() => { setLeague(item); setLimit(PAGE_SIZE); }}>{item === "ALL" ? t("team.allChip") : item}</button>)}</div>
      {otherLeagues.length > 0 && <label className="team-other-league">{t("team.otherLeague")}<select value={otherLeagues.includes(league) ? league : ""} onChange={(event) => { if (event.target.value) { setLeague(event.target.value); setLimit(PAGE_SIZE); } }}><option value="">{t("team.chooseLeague")}</option>{otherLeagues.map((item) => <option key={item}>{item}</option>)}</select></label>}
      <p className="team-choice-count" role="status">{selected
        ? format("team.countCurrent", { league: leagueLabel, count: results.length, team: selected.team_name })
        : format("team.count", { league: leagueLabel, count: results.length })}</p>
      <div className="team-choice-grid">{results.slice(0, limit).map((team) => <button type="button" key={team.team_id} aria-pressed={team.team_id === value} onClick={() => choose(team.team_id)}><span>{team.leagues.join(" · ")}{team.team_id === value ? t("team.selected") : ""}</span><strong>{team.team_name}</strong><small>{format("team.sample", { count: team.game_count })}</small></button>)}</div>
      {!results.length && <div className="team-choice-empty"><p>{t("team.empty")}</p><button type="button" onClick={() => { setLeague("ALL"); setQuery(""); setLimit(PAGE_SIZE); }}>{t("team.resetSearch")}</button></div>}
      <footer>{results.length > limit && <button type="button" onClick={() => setLimit((count) => count + PAGE_SIZE)}>{format("team.more", { count: PAGE_SIZE })}</button>}{allowClear && selected && <button type="button" onClick={() => choose("")}>{t("team.clear")}</button>}</footer>
    </dialog>
  </div>;
}
