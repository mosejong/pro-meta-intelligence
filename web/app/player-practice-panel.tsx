"use client";

/* eslint-disable @next/next/no-img-element -- champion portraits use the stable Riot CDN */

import { type ChangeEvent, useMemo, useRef, useState } from "react";
import { championImageUrl } from "./champion-assets";
import { useChampionNames } from "./champion-names";
import {
  PRIVATE_PRACTICE_MAX_BYTES,
  parsePrivatePracticeSession,
  privatePracticeTemplate,
  summarizePrivatePractice,
  type PrivatePracticeSession,
} from "./player-practice";
import type { OpponentPlayerProfile, OpponentTeam } from "./radar-types";

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

export function PlayerPracticePanel({ ownTeam, opponent }: { ownTeam?: OpponentTeam; opponent?: OpponentTeam }) {
  const { nameOf } = useChampionNames();
  const inputRef = useRef<HTMLInputElement>(null);
  const [session, setSession] = useState<PrivatePracticeSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  const summaries = useMemo(
    () => session ? summarizePrivatePractice(session, ownTeam?.player_profiles) : [],
    [ownTeam?.player_profiles, session],
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
    } catch (caught) {
      setSession(null);
      setError(caught instanceof Error ? caught.message : "연습 JSON을 읽지 못했습니다.");
    }
  }

  function removeSession() {
    setSession(null);
    setError(null);
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
          {session && <button type="button" className="remove" onClick={removeSession}>세션에서 제거</button>}
        </div>
      </header>

      {error && <p className="private-practice-error" role="alert">{error}</p>}
      {!ownTeam ? <div className="private-practice-empty"><b>내 팀을 먼저 선택하세요.</b><p>상단의 MY TEAM LENS에서 소속 팀을 고른 뒤 그 팀 이름이 적힌 JSON만 불러올 수 있습니다.</p></div> : session ? <div className="private-practice-loaded">
        <div className="private-session-meta"><span>{session.team_name}</span><strong>{summaries.length}명 · {session.rows.length}개 챔피언 기록</strong><small>기록 시각 {new Date(session.recorded_at).toLocaleString("ko-KR")}</small></div>
        <div className="private-player-list">{summaries.map((summary) => <article className={summary.matches_public_roster ? "matched" : "unmatched"} key={`${summary.role}:${summary.player_name}`}>
          <header><div><span>{roleLabels[summary.role]}</span><strong>{summary.player_name}</strong></div><b>{summary.matches_public_roster ? "PUBLIC ROSTER MATCH" : "이름 확인 필요"}</b></header>
          <dl><div><dt>연습 게임</dt><dd>{summary.games}</dd></div><div><dt>챔피언</dt><dd>{summary.unique_champion_count}</dd></div><div><dt>승률</dt><dd>{summary.wins === null ? "미입력" : percent(summary.wins / summary.games)}</dd></div><div><dt>체감 숙련</dt><dd>{summary.average_comfort === null ? "미입력" : `${summary.average_comfort.toFixed(1)} / 5`}</dd></div></dl>
          <div className="private-player-champions">{summary.rows.map((row) => <span key={row.champion_id}><img src={championImageUrl(row.champion_id)} alt="" /><b>{nameOf(row.champion_id)}</b><small>{row.games}G{row.comfort ? ` · 체감 ${row.comfort}/5` : ""}</small></span>)}</div>
          <footer>{summary.last_practiced_at ? `최근 입력 ${new Date(summary.last_practiced_at).toLocaleDateString("ko-KR")}` : "최근 연습일 미입력"} · 자기 보고값, 실력 판정 아님</footer>
        </article>)}</div>
      </div> : <div className="private-practice-empty"><b>{ownTeam.team_name} 내부 기록을 선택적으로 겹쳐보세요.</b><p>샘플 JSON을 내려받아 값을 채운 뒤 불러오세요. 업로드·서버 저장·AI 전송 없이 이 탭의 메모리에만 유지됩니다.</p></div>}

      <footer className="private-practice-boundary"><b>PRIVATE DATA BOUNDARY</b><p>탭을 닫거나 내 팀을 바꾸면 사라집니다. 서버·로컬 저장소·AI·발행 피드로 전송하지 않습니다.</p><span>상대팀 연습 데이터 금지</span></footer>
    </article>
  </section>;
}
