"use client";

/* eslint-disable @next/next/no-img-element -- champion portraits use the stable Riot CDN */

import { type FormEvent, useMemo, useState } from "react";
import type { AIValidationStatus } from "./ai-validation";
import { championImageUrl } from "./champion-assets";
import { useChampionNames } from "./champion-names";
import type { PrivatePracticeSession } from "./player-practice";
import {
  answerPlayerTendencyQuestion,
  type TendencyBotAnswer,
  type TendencyBotScope,
} from "./player-tendency-bot";
import type { OpponentTeam } from "./radar-types";

const roleLabels: Record<string, string> = {
  TOP: "탑",
  JUNGLE: "정글",
  MID: "미드",
  BOTTOM: "바텀",
  SUPPORT: "서포터",
};

const intentLabels: Record<string, string> = {
  SUMMARY: "종합 요약",
  CHAMPION_POOL: "챔피언 반복",
  PRACTICE_CROSSCHECK: "내부 연습 교차",
  ROLE_COMPARISON: "동일 포지션 비교",
  EVIDENCE_RISK: "표본·위험",
  PROHIBITED_INFERENCE: "추정 금지",
};

type AnswerState = { contextKey: string; answer: TendencyBotAnswer };

function currentPlayers(team: OpponentTeam | undefined) {
  return (team?.player_profiles ?? [])
    .filter((player) => player.roster_status === "CURRENT")
    .sort((left, right) => Object.keys(roleLabels).indexOf(left.role) - Object.keys(roleLabels).indexOf(right.role));
}

export function PlayerTendencyBotPanel({
  ownTeam,
  opponent,
  privateSession,
  aiValidation,
}: {
  ownTeam?: OpponentTeam;
  opponent?: OpponentTeam;
  privateSession: PrivatePracticeSession | null;
  aiValidation: AIValidationStatus | null;
}) {
  const { nameOf } = useChampionNames();
  const [scope, setScope] = useState<TendencyBotScope>("OWN_TEAM");
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [query, setQuery] = useState("공개 경기에서 가장 반복된 챔피언은?");
  const [answerState, setAnswerState] = useState<AnswerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const team = scope === "OWN_TEAM" ? ownTeam : opponent;
  const comparisonTeam = scope === "OWN_TEAM" ? opponent : ownTeam;
  const players = useMemo(() => currentPlayers(team), [team]);
  const playerId = players.some((player) => player.player_id === selectedPlayerId)
    ? selectedPlayerId
    : players[0]?.player_id ?? "";
  const selectedPlayer = players.find((player) => player.player_id === playerId);
  const contextKey = `${scope}:${team?.team_id ?? "none"}:${playerId}`;
  const answer = answerState?.contextKey === contextKey ? answerState.answer : null;
  const minimumCases = aiValidation?.policy.minimum_paired_holdout_cases ?? 30;
  const pairedCases = aiValidation?.paired_holdout_case_count ?? 0;
  const aiGateLabel = aiValidation?.ai_features_enabled
    ? "AI VALIDATED · PROVIDER NOT CONNECTED"
    : aiValidation
      ? `AI LOCKED · ${pairedCases}/${minimumCases}`
      : "AI GATE CHECKING";

  function analyze(nextQuery: string) {
    if (!team || !playerId) {
      setError("분석할 팀과 선수를 먼저 선택하세요.");
      return;
    }
    try {
      const answer = answerPlayerTendencyQuestion({
        query: nextQuery,
        scope,
        team,
        comparisonTeam,
        playerId,
        privateSession: scope === "OWN_TEAM" ? privateSession : null,
      });
      setAnswerState({ contextKey, answer });
      setQuery(nextQuery);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "질문을 분석하지 못했습니다.");
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    analyze(query);
  }

  return <section className="player-tendency-bot" aria-label="선수 선택 성향 분석봇">
    <header>
      <div><span>TENDENCY ANALYST BOT · EVIDENCE FIRST</span><h3>선수 성향 분석봇</h3><p>선수의 성격이 아니라 공개 경기의 선택 패턴을 답합니다. 내 팀 질문일 때만 현재 탭의 개인 연습 기록을 교차합니다.</p></div>
      <b className={aiValidation?.ai_features_enabled ? "validated" : "locked"}><i /> {aiGateLabel}</b>
    </header>

    {!ownTeam ? <div className="tendency-bot-setup"><b>내 팀을 선택하면 분석봇이 열립니다.</b><p>질문은 저장하거나 서버로 보내지 않습니다.</p></div> : <>
      <div className="tendency-bot-controls">
        <fieldset><legend>분석 범위</legend><button type="button" className={scope === "OWN_TEAM" ? "active" : ""} onClick={() => { setScope("OWN_TEAM"); setSelectedPlayerId(""); }}>내 팀 공개 + 내부</button><button type="button" disabled={!opponent} className={scope === "OPPONENT" ? "active" : ""} onClick={() => { setScope("OPPONENT"); setSelectedPlayerId(""); }}>선택 상대 공개만</button></fieldset>
        <label><span>분석 선수</span><select value={playerId} onChange={(event) => setSelectedPlayerId(event.target.value)} disabled={!players.length}>{players.length ? players.map((player) => <option value={player.player_id} key={player.player_id}>{roleLabels[player.role] ?? player.role} · {player.player_name} · {player.game_count}G</option>) : <option value="">공개 현재 선수 없음</option>}</select></label>
        <div className="tendency-bot-subject">{selectedPlayer?.champions[0] ? <img src={championImageUrl(selectedPlayer.champions[0].champion_id)} alt="" /> : <span />}{selectedPlayer ? <div><small>{team?.team_name} · {roleLabels[selectedPlayer.role] ?? selectedPlayer.role}</small><strong>{selectedPlayer.player_name}</strong><em>{selectedPlayer.champions[0] ? `${nameOf(selectedPlayer.champions[0].champion_id)} ${Math.round(selectedPlayer.champions[0].game_rate * 100)}% 관측` : "챔피언 연결 없음"}</em></div> : <div><small>PUBLIC ROSTER</small><strong>선수 제한</strong><em>데이터를 확인하세요.</em></div>}</div>
      </div>

      <nav className="tendency-bot-prompts" aria-label="추천 질문">{[
        "공개 경기에서 가장 반복된 챔피언은?",
        "내 연습 기록과 어디가 겹쳐?",
        "같은 포지션 상대와 비교해줘",
        "표본과 해석 위험을 알려줘",
      ].map((prompt) => <button type="button" onClick={() => analyze(prompt)} key={prompt}>{prompt}</button>)}</nav>

      <form className="tendency-bot-query" onSubmit={submit}><label htmlFor="tendency-bot-question">선수 선택 성향 질문</label><div><input id="tendency-bot-question" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={160} placeholder="예: 공개 경기에서 가장 반복된 챔피언은?" autoComplete="off" /><button type="submit" disabled={!playerId}>근거로 답하기</button></div><small>이 질문은 현재 탭에서만 처리됩니다. 생성형 AI 호출·서버 저장·대화 기록 없음.</small></form>
      {error && <p className="tendency-bot-error" role="alert">{error}</p>}

      {answer ? <article className={`tendency-bot-answer ${answer.intent === "PROHIBITED_INFERENCE" ? "refused" : ""}`}>
        <header><div><span>{intentLabels[answer.intent]} · {answer.evidence_state}</span><h4>{answer.headline}</h4></div><b>규칙 기반 · AI 생성 아님</b></header>
        <p className="tendency-bot-conclusion">{answer.conclusion}</p>
        <div className="tendency-bot-facts">{answer.facts.map((fact) => <section className={fact.evidence_type.toLowerCase()} key={`${fact.label}:${fact.value}`}><span>{fact.label}</span><strong>{fact.value}</strong><p>{fact.detail}</p><small>{fact.evidence_type === "PUBLIC_MATCH" ? "공개 경기" : fact.evidence_type === "PRIVATE_SESSION" ? "현재 탭 내부 기록" : "데이터 경계"}</small></section>)}</div>
        <details><summary>근거 ID와 분석 경계 <span>＋</span></summary><div className="tendency-bot-evidence"><section><b>PUBLIC EVIDENCE · {answer.evidence_ids.length}</b><div>{answer.evidence_ids.length ? answer.evidence_ids.map((id) => <code key={id}>{id}</code>) : <p>연결된 공개 근거 ID가 없습니다.</p>}</div></section><section><b>BOUNDARIES</b><ul>{answer.boundaries.map((boundary) => <li key={boundary}>{boundary}</li>)}</ul></section></div></details>
        <footer><b>{answer.private_data_used ? "PRIVATE LOCAL ANSWER · 발행 금지" : "PUBLIC EVIDENCE ANSWER"}</b><p>정답이나 선수 평가가 아니라 다음 검토 질문을 줄이기 위한 답변입니다.</p></footer>
      </article> : <div className="tendency-bot-empty"><b>질문 하나를 선택하세요.</b><p>챔피언 반복, 내 연습 교차, 동일 포지션 비교, 표본 위험을 근거와 함께 답합니다.</p></div>}
    </>}

    <footer><b>AI RELEASE GATE</b><p>현재 Bot Core는 결정론적 근거 라우터입니다. 생성형 모델은 동일 홀드아웃 30개에서 정확도·경계 보존·시간 절감을 통과하기 전까지 연결하지 않습니다.</p><span>성격·멘탈 추정 금지</span></footer>
  </section>;
}
