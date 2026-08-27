"use client";

/* eslint-disable @next/next/no-img-element -- champion portraits use the stable Riot CDN */

import { type ChangeEvent, type FormEvent, useMemo, useRef, useState } from "react";
import { championImageUrl } from "./champion-assets";
import { useChampionNames } from "./champion-names";
import {
  PRIVATE_PRACTICE_MAX_BYTES,
  buildPracticeCandidateCoverage,
  classifyPracticeRow,
  parsePrivatePracticeSession,
  practiceRoles,
  privatePracticeRowKey,
  privatePracticeTemplate,
  summarizePrivatePractice,
  upsertPrivatePracticeRow,
  type PracticeRole,
  type PrivatePracticeRow,
  type PrivatePracticeSession,
} from "./player-practice";
import type { OpponentPlayerProfile, OpponentTeam, RadarEntry } from "./radar-types";

const roleLabels: Record<string, string> = {
  TOP: "탑",
  JUNGLE: "정글",
  MID: "미드",
  BOTTOM: "바텀",
  SUPPORT: "서포터",
};

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

type PracticeDraft = {
  player_name: string;
  role: PracticeRole;
  champion_id: string;
  games: string;
  wins: string;
  comfort: string;
  last_practiced_at: string;
};

function initialPracticeDraft(ownTeam: OpponentTeam | undefined): PracticeDraft {
  const player = (ownTeam?.player_profiles ?? []).find((candidate) => candidate.roster_status === "CURRENT");
  return {
    player_name: player?.player_name ?? "",
    role: practiceRoles.includes(player?.role as PracticeRole) ? player?.role as PracticeRole : "MID",
    champion_id: player?.champions[0]?.champion_id ?? ownTeam?.priority_picks[0]?.champion_id ?? "",
    games: "1",
    wins: "",
    comfort: "",
    last_practiced_at: "",
  };
}

function PublicPlayerColumn({ team, label }: { team: OpponentTeam | undefined; label: string }) {
  const { nameOf } = useChampionNames();
  const players = (team?.player_profiles ?? [])
    .filter((player) => player.roster_status === "CURRENT")
    .sort((left, right) => Object.keys(roleLabels).indexOf(left.role) - Object.keys(roleLabels).indexOf(right.role));

  return <article className="player-public-column">
    <header><div><span>{label}</span><h3>{team?.team_name ?? "팀 선택 필요"}</h3></div><b>{team ? `${team.game_count}G PUBLIC` : "WAITING"}</b></header>
    {players.length ? <div className="player-public-list">{players.map((player) => <PublicPlayerCard player={player} key={player.player_id} />)}</div> : <div className="player-public-empty"><b>공개 선수 표본 없음</b><p>{team ? "현재 발행본에 선수별 픽 연결이 없습니다." : "내 팀을 선택하면 공개 경기 기반 선수 성향을 보여줍니다."}</p></div>}
    <footer>최근 공개 프로 경기에서 관측된 선택 비율 · 숙련도나 출전 가능성 아님</footer>
  </article>;

  function PublicPlayerCard({ player }: { player: OpponentPlayerProfile }) {
    const lead = player.champions[0];
    return <div className="player-public-card">
      {lead ? <img src={championImageUrl(lead.champion_id)} alt="" loading="lazy" /> : <span className="player-public-placeholder" />}
      <div className="player-public-name"><span>{roleLabels[player.role] ?? player.role}</span><strong>{player.player_name}</strong><small>{player.game_count}경기 관측</small></div>
      <div className="player-public-pool">{player.champions.slice(0, 3).map((champion) => <span key={champion.champion_id}><img src={championImageUrl(champion.champion_id)} alt="" loading="lazy" /><b>{nameOf(champion.champion_id)}</b><small>{champion.game_count}G · {percent(champion.game_rate)}</small></span>)}</div>
    </div>;
  }
}

function downloadJson(fileName: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function PlayerPracticePanel({
  ownTeam,
  opponent,
  reviewCandidates = [],
}: {
  ownTeam?: OpponentTeam;
  opponent?: OpponentTeam;
  reviewCandidates?: RadarEntry[];
}) {
  const { catalog, nameOf } = useChampionNames();
  const inputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLFormElement>(null);
  const [session, setSession] = useState<PrivatePracticeSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<PracticeDraft>(() => initialPracticeDraft(ownTeam));

  const currentPlayers = useMemo(
    () => (ownTeam?.player_profiles ?? []).filter((player) => player.roster_status === "CURRENT"),
    [ownTeam?.player_profiles],
  );

  const championOptions = useMemo(() => {
    const ids = new Set<string>();
    Object.keys(catalog).forEach((id) => ids.add(id));
    currentPlayers.forEach((player) => player.champions.forEach((champion) => ids.add(champion.champion_id)));
    ownTeam?.priority_picks.forEach((champion) => ids.add(champion.champion_id));
    if (draft.champion_id) ids.add(draft.champion_id);
    return [...ids]
      .map((id) => ({ id, label: nameOf(id) }))
      .sort((left, right) => left.label.localeCompare(right.label, "ko-KR"));
  }, [catalog, currentPlayers, draft.champion_id, nameOf, ownTeam?.priority_picks]);

  const summaries = useMemo(
    () => session ? summarizePrivatePractice(session, ownTeam?.player_profiles) : [],
    [ownTeam?.player_profiles, session],
  );
  const publicOverlapCount = useMemo(
    () => session?.rows.filter((row) => classifyPracticeRow(row, ownTeam?.player_profiles).status === "PUBLIC_OVERLAP").length ?? 0,
    [ownTeam?.player_profiles, session],
  );
  const candidateCoverage = useMemo(
    () => ownTeam ? buildPracticeCandidateCoverage(reviewCandidates, ownTeam, session) : [],
    [ownTeam, reviewCandidates, session],
  );

  async function loadPractice(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !ownTeam) return;
    if (file.size > PRIVATE_PRACTICE_MAX_BYTES) {
      setError("파일이 256KB를 넘습니다. 한 세션은 최대 250행만 불러올 수 있습니다.");
      return;
    }
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      setSession(parsePrivatePracticeSession(parsed, ownTeam));
      setError(null);
      setNotice("개인 JSON을 현재 탭에 불러왔습니다.");
    } catch (caught) {
      setSession(null);
      setError(caught instanceof Error ? caught.message : "연습 JSON을 읽지 못했습니다.");
      setNotice(null);
    }
  }

  function changePlayer(playerName: string) {
    const player = currentPlayers.find((candidate) => candidate.player_name === playerName);
    setDraft((current) => ({
      ...current,
      player_name: playerName,
      ...(player ? {
        role: practiceRoles.includes(player.role as PracticeRole) ? player.role as PracticeRole : current.role,
        champion_id: player.champions[0]?.champion_id ?? current.champion_id,
      } : {}),
    }));
  }

  function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ownTeam) return;
    const row: PrivatePracticeRow = {
      player_name: draft.player_name,
      role: draft.role,
      champion_id: draft.champion_id,
      games: Number(draft.games),
      ...(draft.wins === "" ? {} : { wins: Number(draft.wins) }),
      ...(draft.comfort === "" ? {} : { comfort: Number(draft.comfort) }),
      ...(draft.last_practiced_at ? { last_practiced_at: draft.last_practiced_at } : {}),
    };
    const replacing = session?.rows.some((candidate) => privatePracticeRowKey(candidate) === privatePracticeRowKey(row)) ?? false;
    try {
      setSession(upsertPrivatePracticeRow(ownTeam, session, row));
      setError(null);
      setNotice(replacing ? "같은 선수·포지션·챔피언 기록을 갱신했습니다." : "연습 기록을 현재 탭에 추가했습니다.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "연습 기록을 추가하지 못했습니다.");
      setNotice(null);
    }
  }

  function removeRow(row: PrivatePracticeRow) {
    if (!session) return;
    const rowKey = privatePracticeRowKey(row);
    const rows = session.rows.filter((candidate) => privatePracticeRowKey(candidate) !== rowKey);
    setSession(rows.length ? { ...session, recorded_at: new Date().toISOString(), rows } : null);
    setError(null);
    setNotice("선택한 연습 기록을 현재 탭에서 제거했습니다.");
  }

  function prepareCandidate(championId: string, role: string) {
    const player = currentPlayers.find((candidate) => candidate.role === role);
    setDraft((current) => ({
      ...current,
      player_name: player?.player_name ?? current.player_name,
      role: practiceRoles.includes(role as PracticeRole) ? role as PracticeRole : current.role,
      champion_id: championId,
    }));
    editorRef.current?.scrollIntoView({ behavior: "auto", block: "center" });
    editorRef.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  }

  function removeSession() {
    setSession(null);
    setError(null);
    setNotice(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return <section className="player-practice" id="player-practice" aria-label="선수 공개 성향 및 내 팀 개인 연습">
    <header className="player-practice-head">
      <div><span>PLAYER LENS · PUBLIC + PRIVATE</span><h2>선수 성향과 개인 연습을 섞지 않고 봅니다.</h2><p>공개 경기에서 확인된 챔피언 반복과 내 팀이 직접 넣은 연습 기록을 나란히 비교합니다. 상대의 비공개 연습은 받거나 추정하지 않습니다.</p></div>
      <b><i /> PRIVATE STAYS IN MEMORY</b>
    </header>

    <div className="player-public-grid">
      <PublicPlayerColumn team={ownTeam} label="MY TEAM · PUBLIC MATCHES" />
      <PublicPlayerColumn team={opponent} label="SELECTED OPPONENT · PUBLIC MATCHES" />
    </div>

    <article className={`private-practice ${session ? "loaded" : "empty"}`}>
      <header>
        <div><span>OWN TEAM ONLY · OPTIONAL</span><h3>개인 연습 세션 오버레이</h3><p>게임 수는 필수, 승수·체감 숙련도(1~5)·최근 연습일은 선택입니다. 자유 메모와 계정 정보는 받지 않습니다.</p></div>
        <div className="private-practice-actions">
          <input ref={inputRef} id="private-practice-file" type="file" accept="application/json,.json" onChange={(event) => void loadPractice(event)} disabled={!ownTeam} />
          <label aria-disabled={!ownTeam} htmlFor="private-practice-file">연습 JSON 불러오기</label>
          <button type="button" disabled={!ownTeam} onClick={() => ownTeam && downloadJson(`private-practice-template-${ownTeam.team_name}.json`, privatePracticeTemplate(ownTeam))}>샘플 JSON</button>
          {session && <button type="button" onClick={() => downloadJson(`private-practice-${session.team_name}-${session.recorded_at.slice(0, 10)}.json`, session)}>현재 JSON 내보내기</button>}
          {session && <button type="button" className="remove" onClick={removeSession}>세션에서 제거</button>}
        </div>
      </header>

      {ownTeam && <form ref={editorRef} className="private-practice-editor" onSubmit={saveDraft}>
        <header><span>빠른 입력</span><strong>JSON 편집 없이 한 줄씩 기록</strong><small>같은 선수·포지션·챔피언은 자동 갱신</small></header>
        <div className="private-practice-fields">
          <label><span>선수</span><input required list="private-practice-player-options" value={draft.player_name} onChange={(event) => changePlayer(event.target.value)} placeholder="선수명" /><datalist id="private-practice-player-options">{currentPlayers.map((player) => <option value={player.player_name} key={player.player_id}>{roleLabels[player.role] ?? player.role}</option>)}</datalist></label>
          <label><span>포지션</span><select value={draft.role} onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value as PracticeRole }))}>{practiceRoles.map((role) => <option value={role} key={role}>{roleLabels[role]}</option>)}</select></label>
          <label className="champion-field"><span>챔피언</span><select required value={draft.champion_id} onChange={(event) => setDraft((current) => ({ ...current, champion_id: event.target.value }))}><option value="">챔피언 선택</option>{championOptions.map((champion) => <option value={champion.id} key={champion.id}>{champion.label} · {champion.id}</option>)}</select></label>
          <label><span>게임 수</span><input required type="number" min="1" max="999" inputMode="numeric" value={draft.games} onChange={(event) => setDraft((current) => ({ ...current, games: event.target.value }))} /></label>
          <label><span>승수 <em>선택</em></span><input type="number" min="0" max={draft.games || "999"} inputMode="numeric" value={draft.wins} onChange={(event) => setDraft((current) => ({ ...current, wins: event.target.value }))} placeholder="—" /></label>
          <label><span>체감 숙련 <em>선택</em></span><select value={draft.comfort} onChange={(event) => setDraft((current) => ({ ...current, comfort: event.target.value }))}><option value="">미입력</option>{[1, 2, 3, 4, 5].map((score) => <option value={score} key={score}>{score} / 5</option>)}</select></label>
          <label><span>최근 연습일 <em>선택</em></span><input type="date" value={draft.last_practiced_at} onChange={(event) => setDraft((current) => ({ ...current, last_practiced_at: event.target.value }))} /></label>
          <button type="submit">기록 추가 / 갱신</button>
        </div>
      </form>}

      {error && <p className="private-practice-error" role="alert">{error}</p>}
      {notice && <p className="private-practice-notice" role="status">{notice}</p>}
      {!ownTeam ? <div className="private-practice-empty"><b>내 팀을 먼저 선택하세요.</b><p>상단의 MY TEAM LENS에서 소속 팀을 고른 뒤 그 팀 이름이 적힌 JSON만 불러올 수 있습니다.</p></div> : session ? <div className="private-practice-loaded">
        <div className="private-session-meta"><span>{session.team_name}</span><strong>{summaries.length}명 · {session.rows.length}개 챔피언 기록 · 공개 성향 겹침 {publicOverlapCount}개</strong><small>기록 시각 {new Date(session.recorded_at).toLocaleString("ko-KR")}</small></div>
        <div className="private-player-list">{summaries.map((summary) => <article className={summary.matches_public_roster ? "matched" : "unmatched"} key={`${summary.role}:${summary.player_name}`}>
          <header><div><span>{roleLabels[summary.role]}</span><strong>{summary.player_name}</strong></div><b>{summary.matches_public_roster ? "PUBLIC ROSTER MATCH" : "이름 확인 필요"}</b></header>
          <dl><div><dt>연습 게임</dt><dd>{summary.games}</dd></div><div><dt>챔피언</dt><dd>{summary.unique_champion_count}</dd></div><div><dt>승률</dt><dd>{summary.wins === null ? "미입력" : percent(summary.wins / summary.games)}</dd></div><div><dt>체감 숙련</dt><dd>{summary.average_comfort === null ? "미입력" : `${summary.average_comfort.toFixed(1)} / 5`}</dd></div></dl>
          <div className="private-player-champions">{summary.rows.map((row) => {
            const overlap = classifyPracticeRow(row, ownTeam.player_profiles);
            return <div className={`private-champion-record ${overlap.status.toLowerCase()}`} key={row.champion_id}><img src={championImageUrl(row.champion_id)} alt="" /><span><b>{nameOf(row.champion_id)}</b><small>{row.games}G{row.comfort ? ` · 체감 ${row.comfort}/5` : ""}</small><em>{overlap.status === "PUBLIC_OVERLAP" ? `공개 ${overlap.public_game_count}G · ${percent(overlap.public_game_rate ?? 0)}` : overlap.status === "PRIVATE_ONLY" ? "내부 연습에만 있음" : "로스터 이름 확인"}</em></span><button type="button" onClick={() => removeRow(row)} aria-label={`${summary.player_name} ${nameOf(row.champion_id)} 연습 기록 제거`}>×</button></div>;
          })}</div>
          <footer>{summary.last_practiced_at ? `최근 입력 ${new Date(summary.last_practiced_at).toLocaleDateString("ko-KR")}` : "최근 연습일 미입력"} · 자기 보고값, 실력 판정 아님</footer>
        </article>)}</div>
      </div> : <div className="private-practice-empty"><b>{ownTeam.team_name} 내부 기록을 선택적으로 겹쳐보세요.</b><p>샘플 JSON을 내려받아 값을 채운 뒤 불러오세요. 업로드·서버 저장·AI 전송 없이 이 탭의 메모리에만 유지됩니다.</p></div>}

      {ownTeam && candidateCoverage.length > 0 && <section className="practice-candidate-coverage" aria-label="우선 검토 후보 개인 연습 커버리지">
        <header><div><span>TEAM DECISION × PRIVATE PRACTICE</span><h3>우선 검토 후보의 연습 기록만 빠르게 확인</h3><p>공개 Radar 순위는 그대로 두고, 현재 탭의 내 팀 기록이 있는지만 선수 단위로 교차합니다.</p></div><b>{candidateCoverage.filter((candidate) => candidate.status === "PRACTICE_RECORDED").length} / {candidateCoverage.length} 기록 있음</b></header>
        <div className="practice-candidate-grid">{candidateCoverage.map((candidate) => <article className={candidate.status.toLowerCase()} key={`${candidate.champion_id}:${candidate.role}`}>
          <header><span className="practice-candidate-rank">#{String(candidate.radar_rank).padStart(2, "0")}</span><img src={championImageUrl(candidate.champion_id)} alt="" loading="lazy" /><div><small>{roleLabels[candidate.role] ?? candidate.role}</small><strong>{nameOf(candidate.champion_id)}</strong></div><b>{candidate.status === "PRACTICE_RECORDED" ? "기록 있음" : candidate.status === "NO_MATCHING_PRACTICE" ? "일치 기록 없음" : candidate.status === "NO_PRIVATE_SESSION" ? "세션 미입력" : "로스터 제한"}</b></header>
          <div className="practice-candidate-players">{candidate.players.length ? candidate.players.map((player) => <p className={player.row ? "recorded" : "missing"} key={player.player_id}><span>{player.player_name}</span><strong>{player.row ? `${player.row.games}G${player.row.comfort ? ` · 체감 ${player.row.comfort}/5` : ""}` : "기록 없음"}</strong></p>) : <p className="missing"><span>{roleLabels[candidate.role] ?? candidate.role}</span><strong>공개 현재 선수 없음</strong></p>}</div>
          <footer><span>{candidate.status === "PRACTICE_RECORDED" ? `합계 ${candidate.total_practice_games}G · 리플레이와 선수 피드백 확인` : candidate.unmatched_row_count > 0 ? `이름 미일치 기록 ${candidate.unmatched_row_count}개 · 먼저 로스터 확인` : "기록 부재는 미숙련을 뜻하지 않음"}</span><button type="button" onClick={() => prepareCandidate(candidate.champion_id, candidate.role)}>이 후보 기록</button></footer>
        </article>)}</div>
        <footer><b>NO AUTO-RANKING</b><p>개인 연습값은 Radar 순위, 상대 우선순위, 출전 판단을 변경하지 않습니다. 기록 유무만 회의 전에 확인하세요.</p></footer>
      </section>}

      <footer className="private-practice-boundary"><b>PRIVATE DATA BOUNDARY</b><p>탭을 닫거나 내 팀을 바꾸면 사라집니다. 서버·로컬 저장소·AI·발행 피드로 전송하지 않습니다.</p><span>상대팀 연습 데이터 금지</span></footer>
    </article>
  </section>;
}
