import type { RadarReport } from "./radar-types";
import { buildWorldsPreparation, WORLDS_2026 } from "./worlds-preparation";
import "./worlds-preparation.css";

export function WorldsPreparationPanel({ report, canChangeMatchup, onChooseOpponent, nameOf }: {
  report: RadarReport;
  canChangeMatchup: boolean;
  onChooseOpponent: (teamId: string) => void;
  nameOf: (championId: string) => string;
}) {
  const entries = buildWorldsPreparation(report);
  const ownTeam = entries.find((entry) => entry.code === "T1")?.team;
  return <details className="worlds-preparation" open>
    <summary><strong>WORLDS 2026 · 준비실</strong><span>10.15–11.14 · 공식 일정 기준</span></summary>
    <div className="worlds-preparation-content">
      <p>T1 진출 확인 · 아래 팀은 출전 명단에서 확인한 연습 대상입니다. 실제 대진은 아직 지정하지 않았습니다.</p>
      <div className="worlds-preparation-status">
        <span><b>대회 패치</b>공식 자료 확인 대기</span>
        <span><b>현재 분석</b>{report.fixture_only ? "예제" : "공개 경기"} · {report.patch_id} · {report.cutoff.slice(0, 10)} 기준</span>
        <span><b>밴픽 형식</b>선픽 진영 분리 · 하드 피어리스 연습 · 월즈 세부 규정 확인 필요</span>
      </div>
      <p>시즌 기록으로 상대 성향을 먼저 비교하세요. 현재 분석 패치를 월즈 패치로 간주하지 않습니다.</p>
      <div className="worlds-opponents">
        {entries.filter((entry) => entry.code !== "T1").map((entry) => <article key={entry.code}>
          <header><strong>{entry.code}</strong><span>{entry.league} · 진출 확인</span></header>
          <p>{entry.team?.team_name ?? entry.names[0]} · {entry.sample ? `${entry.sample}경기 표본` : "현재 분석 표본 없음"}</p>
          <p>{entry.first_picks.length ? entry.first_picks.map(nameOf).join(" · ") : "패치별 픽 근거 보강 필요"}</p>
          <button type="button" disabled={!canChangeMatchup || !ownTeam || !entry.team || entry.sample === 0}
            onClick={() => entry.team && onChooseOpponent(entry.team.team_id)}>T1 vs {entry.code} 연습</button>
        </article>)}
      </div>
      {!canChangeMatchup && <p>진행 중인 밴픽은 유지됩니다. 상대 변경은 빈 시리즈에서 할 수 있습니다.</p>}
      <p className="worlds-preparation-sources">{WORLDS_2026.checked_on} 확인 · 전체 출전 명단은 아직 미완성 ·
        <a href={WORLDS_2026.qualification_source} target="_blank" rel="noreferrer">공식 진출 명단</a> ·
        <a href={WORLDS_2026.schedule_source} target="_blank" rel="noreferrer">공식 일정</a> ·
        <a href={WORLDS_2026.first_selection_source} target="_blank" rel="noreferrer">선픽 규칙 안내</a></p>
    </div>
  </details>;
}
