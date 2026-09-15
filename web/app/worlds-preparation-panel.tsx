import type { RadarReport } from "./radar-types";
import { isChampionLocked } from "./draft-agent";
import { buildWorldsPreparation, WORLDS_2026 } from "./worlds-preparation";
import "./worlds-preparation.css";

export function WorldsPreparationPanel({ report, canChangeMatchup, onChooseOpponent, nameOf, previousPicks = [] }: {
  report: RadarReport;
  canChangeMatchup: boolean;
  onChooseOpponent: (teamId: string) => void;
  nameOf: (championId: string) => string;
  previousPicks?: string[];
}) {
  const entries = buildWorldsPreparation(report);
  const ownTeam = entries.find((entry) => entry.code === "T1")?.team;
  return <details className="worlds-preparation" open>
    <summary><strong>WORLDS 2026 · 준비실</strong><span>10.15–11.14 · 공식 일정 기준</span></summary>
    <div className="worlds-preparation-content">
      <p>T1 진출 확인 · 아래 팀은 출전 명단에서 확인한 연습 대상입니다. 실제 대진은 아직 지정하지 않았습니다.</p>
      <div className="worlds-preparation-status">
        <span><b>대회 패치</b>{WORLDS_2026.patch} · 규정집 {WORLDS_2026.rules_version} 확인</span>
        <span><b>현재 분석</b>{report.fixture_only ? "예제" : "공개 경기"} · {report.patch_id} · {report.cutoff.slice(0, 10)} 기준</span>
        <span><b>밴픽 형식</b>선픽·진영 분리 확인 · 피어리스 세부 규정 확인 중</span>
      </div>
      <p><strong>대회 제한 챔피언: 공개 목록 미확인</strong> · {WORLDS_2026.checked_on} 확인 기준. 연습실에 대회 전용 제한 목록은 적용되지 않았습니다.</p>
      <p>시즌 기록으로 상대 성향을 먼저 비교하세요. 현재 분석 패치를 월즈 패치로 간주하지 않습니다.</p>
      <details className="worlds-rules-notes"><summary>공식 선픽 규칙과 연습 범위</summary>
        <p>선택권을 가진 팀이 선후픽 또는 진영을 정하고, 상대가 나머지를 정합니다. 2세트부터는 직전 세트 패배 팀이 선택권을 갖습니다.</p>
        <p>플레이인 최종전 1세트는 승자조 진출 팀이 선후픽과 진영을 모두 고릅니다. 연습실은 선택 결과를 직접 입력하며, 선택권이나 승패를 자동 판정하지 않습니다.</p>
        <p>하드 피어리스는 현재 연습 모드입니다. 이전 세트에서 양 팀이 픽한 챔피언은 이후 세트에서 잠기며, 일반 밴은 다음 세트에 풀립니다. 공통 국제대회 규정의 세부 조항은 검증 대기입니다.</p>
        <p>월즈 규정집 5.1은 제한 목록을 대회 전에 참가 팀에 전달한다고 명시합니다. 공개된 챔피언별 목록은 확인하지 못했으며, 운영진은 대회 중에도 제한이나 패치를 변경할 수 있습니다.</p>
      </details>
      <div className="worlds-opponents">
        {entries.filter((entry) => entry.code !== "T1").map((entry) => <article key={entry.code}>
          <header><strong>{entry.code}</strong><span>{entry.league} · 진출 확인</span></header>
          <p>{entry.team?.team_name ?? entry.names[0]} · {entry.sample ? `${entry.sample}경기 표본` : "현재 분석 표본 없음"}</p>
          <p>{entry.first_picks.length ? entry.first_picks.map(nameOf).join(" · ") : "패치별 픽 근거 보강 필요"}</p>
          <details className="worlds-role-coverage"><summary>역할별 관측 챔피언</summary>
            <ul className="worlds-role-list">{entry.role_coverage.map((item) => {
              const remaining = item.champions.filter((champion) => !isChampionLocked([], champion.champion_id, previousPicks)).length;
              return <li key={item.role}>{item.champion_count ? <details>
                <summary><span>{item.label}</span><b>{item.champion_count}개{previousPicks.length > 0 ? ` · 이전 픽 제외 ${remaining}개` : ""}</b></summary>
                <ul className="worlds-champion-evidence">{item.champions.map((champion) => {
                  const locked = isChampionLocked([], champion.champion_id, previousPicks);
                  return <li key={champion.champion_id}>
                    <span>{nameOf(champion.champion_id)}{locked && <em>피어리스 잠금</em>}</span>
                    <small>{champion.sources.join(" · ")} · 근거 {champion.evidence_count}건</small>
                  </li>;
                })}</ul>
              </details> : <p>{item.label} · 근거 없음</p>}</li>;
            })}</ul>
            {previousPicks.length > 0 && <p>남은 수는 이전 세트 픽만 제외한 값입니다. 현재 세트의 밴픽은 포함하지 않습니다.</p>}
            <p>공개 보고서에 수록된 챔피언만 집계합니다. 역할별 중복은 허용하며 전체 챔피언 폭·숙련도·현재 선수단의 확정값은 아닙니다.</p>
          </details>
          <button type="button" disabled={!canChangeMatchup || !ownTeam || !entry.team || entry.sample === 0}
            onClick={() => entry.team && onChooseOpponent(entry.team.team_id)}>T1 vs {entry.code} 연습</button>
        </article>)}
      </div>
      {!canChangeMatchup && <p>진행 중인 밴픽은 유지됩니다. 상대 변경은 빈 시리즈에서 할 수 있습니다.</p>}
      <p className="worlds-preparation-sources">{WORLDS_2026.checked_on} 확인 · 전체 출전 명단은 아직 미완성 ·
        <a href={WORLDS_2026.qualification_source} target="_blank" rel="noreferrer">공식 진출 명단</a> ·
        <a href={WORLDS_2026.schedule_source} target="_blank" rel="noreferrer">공식 일정</a> ·
        <a href={WORLDS_2026.rules_source} target="_blank" rel="noreferrer">월즈 규정집</a> ·
        <a href={WORLDS_2026.first_selection_source} target="_blank" rel="noreferrer">선픽 규칙 안내</a></p>
    </div>
  </details>;
}
