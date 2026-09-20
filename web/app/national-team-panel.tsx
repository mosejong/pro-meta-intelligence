"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { RadarReport } from "./radar-types";
import { NATIONAL_REVIEWS, NATIONAL_JOURNAL_KEY, nationalSubjects, nationalMatchObservations, nationalClubBaseline,
  createNationalCheck, resolveNationalCheck, parseNationalChecks, serializeNationalChecks, mergeNationalChecks,
  saveNationalChecks, MAX_NATIONAL_FILE_BYTES, type NationalCheck } from "./national-team-analysis";
import "./national-team.css";

const verdictLabels = { SUPPORTED: "관찰과 일치", CONTRADICTED: "관찰과 불일치", INSUFFICIENT: "판정 보류" } as const;

function OutcomeForm({ check, onResolve }: { check: NationalCheck; onResolve: (check: NationalCheck) => void }) {
  const [verdict, setVerdict] = useState<NonNullable<NationalCheck["outcome"]>["verdict"]>("INSUFFICIENT");
  const [observation, setObservation] = useState("");
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    try { onResolve(resolveNationalCheck(check, { verdict, observation: observation.trim(), source_url: source.trim(), recorded_at: new Date().toISOString() })); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "판정 저장 실패"); }
  }
  return <form onSubmit={submit} className="national-check-form">
    <label>판정<select value={verdict} onChange={(event) => setVerdict(event.target.value as typeof verdict)}>
      {Object.entries(verdictLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>
    <label>실제 관찰 · 영상 시각 포함<textarea required maxLength={500} value={observation} onChange={(event) => setObservation(event.target.value)} /></label>
    <label>근거 링크<input required type="url" placeholder="https://…" maxLength={2000} value={source} onChange={(event) => setSource(event.target.value)} /></label>
    <button type="submit">판정 기록 확정</button><p role="status">{error}</p>
  </form>;
}

export function NationalTeamPanel({ report, nameOf }: { report: RadarReport; nameOf: (id: string) => string }) {
  const [subject, setSubject] = useState("Keria");
  const [matchId, setMatchId] = useState("vietnam-20260920");
  const [target, setTarget] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [criterion, setCriterion] = useState("");
  const [checks, setChecks] = useState<NationalCheck[]>([]);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [importing, setImporting] = useState(false);
  const savedRaw = useRef<string | null>(null);
  const currentChecks = useRef<NationalCheck[]>([]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(NATIONAL_JOURNAL_KEY);
        const restored = parseNationalChecks(raw);
        savedRaw.current = raw; currentChecks.current = restored; setChecks(restored);
      }
      catch { setStorageBlocked(true); setMessage("기존 기록을 읽을 수 없어 덮어쓰기를 중단했습니다."); }
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const baseline = nationalClubBaseline(report, subject);
  const review = NATIONAL_REVIEWS.find((item) => item.id === matchId) ?? NATIONAL_REVIEWS[1];
  const observations = nationalMatchObservations(review.id, subject);
  function persist(next: NationalCheck[]) {
    if (storageBlocked) throw new Error("기존 기록 보호를 위해 저장이 중단돼 있습니다.");
    const raw = saveNationalChecks(window.localStorage, savedRaw.current, next);
    savedRaw.current = raw; currentChecks.current = next;
    setChecks(next);
  }
  async function importChecks(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      if (!ready || storageBlocked) throw new Error("기존 기록을 읽을 수 없어 가져오기를 중단했습니다.");
      if (file.size > MAX_NATIONAL_FILE_BYTES) throw new Error("검증 기록은 200KB 이하 JSON 파일만 가져올 수 있습니다.");
      const incoming = parseNationalChecks(await file.text());
      const merged = mergeNationalChecks(currentChecks.current, incoming);
      persist(merged);
      setMessage(`가져오기를 완료했습니다. 중복을 제외한 전체 ${merged.length}건입니다. 기기 시각은 미인증으로 유지됩니다.`);
    } catch (failure) { setMessage(failure instanceof Error ? failure.message : "파일을 가져올 수 없습니다."); }
    finally { input.value = ""; setImporting(false); }
  }
  function freeze(event: FormEvent) {
    event.preventDefault();
    try {
      const check = createNationalCheck({ id: crypto.randomUUID(), created_at: new Date().toISOString(), subject,
        target: target.trim(), hypothesis: hypothesis.trim(), criterion: criterion.trim(), baseline: { patch: report.patch_id, cutoff: report.cutoff } });
      persist([...checks, check]);
      setHypothesis(""); setCriterion(""); setMessage("예상과 판정 기준을 고정했습니다. 결과 확인 후 아래 기록에서 판정하세요.");
    } catch (failure) { setMessage(failure instanceof Error ? failure.message : "브라우저 저장을 사용할 수 없습니다."); }
  }
  function exportChecks() {
    const url = URL.createObjectURL(new Blob([serializeNationalChecks(checks)], { type: "application/json;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "national-team-observation-checks.json"; link.click();
    URL.revokeObjectURL(url);
  }
  return <details className="national-team" open>
    <summary><strong>국가대표 · 성향 관찰실</strong><span>선수 기록 → 대표팀 관찰 → 다음 경기 확인</span></summary>
    <div className="national-content">
      <label className="national-subject">관찰 경기<select value={review.id} onChange={(event) => setMatchId(event.target.value)}>
        {NATIONAL_REVIEWS.map((item) => <option key={item.id} value={item.id}>{item.match}</option>)}
      </select></label>
      <p><b>{review.match}</b> · {review.result} · {review.checked_on} 자료 확인 · 사후 관찰</p>
      <p>기사에서 확인한 일부 선택과 운영 장면입니다. 경기 패치·피어리스 규칙·전체 밴픽 순서는 미확인이라 자동 밴이나 예상 적중률에 반영하지 않습니다.</p>
      <label className="national-subject">비교 대상<select value={subject} onChange={(event) => setSubject(event.target.value)}>
        <option>대한민국 대표팀</option>{nationalSubjects.map((player) => <option key={player.name} value={player.name}>{player.name} · {player.label}</option>)}
      </select></label>
      <div className="national-comparison">
        <section aria-label="소속팀 공개 기록"><h3>소속팀에서 관찰된 선택</h3>
          <p>{report.patch_id} · {report.cutoff.slice(0, 10)} 기준 · 대표팀 표본과 합산하지 않습니다.</p>
          {subject === "대한민국 대표팀" ? <p>각 선수의 소속팀 기록을 합쳐 대표팀 전적으로 만들지 않습니다. 선수를 선택해 비교하세요.</p> : baseline ? <>
            <p><b>{baseline.team_name} · {baseline.game_count}경기</b></p>
            <ul>{baseline.champions.map((pick) => <li key={pick.champion_id}>{nameOf(pick.champion_id)} · {pick.game_count}/{baseline.game_count}경기</li>)}</ul>
            <details><summary>소속팀 근거 경기</summary><p>{baseline.evidence_match_ids.join(" · ")}</p></details>
            <p>보고서에 수록된 제한된 챔피언 목록입니다. 목록에 없다고 사용하지 않았다는 뜻은 아닙니다.</p>
          </> : <p>이 선수의 소속팀·포지션을 유일하게 연결할 공개 표본이 없습니다.</p>}
        </section>
        <section aria-label="국가대표 관찰"><h3>대표팀에서 확인할 변화</h3>
          {observations.length ? <ul className="national-observations">{observations.map((item) => <li key={`${item.player}-${item.game}`}>
            <b>{item.player} · {item.game}세트 · {nameOf(item.champion)}</b><p>{item.fact}</p><p>다음 관찰: {item.question}</p>
          </li>)}</ul> : <p>{review.id === "usa-20260919" && subject === "Faker"
            ? "Faker는 미국전 미출전 보도가 있습니다. 대표팀 선택이 없다는 사실을 기량이나 기용 이유로 해석하지 않습니다."
            : "이 경기 보도에서 확인한 해당 선수의 선택 기록이 없습니다. 기록 누락은 미출전이나 미사용의 근거가 아닙니다."}</p>}
          <p>기사에서 찾은 선택만 표시한 부분 기록입니다. 선택률·전체 챔피언 폭은 계산하지 않습니다.</p>
        </section>
      </div>
      <section className="national-team-notes" aria-label="팀 운영 가설"><h3>팀 운영 가설</h3>
        <p>{review.team_note}</p>
        <p>상대·선발·패치·진영·선픽·세트 번호를 함께 기록하세요. 상대 밴을 특정 선수 견제로 분류하려면 별도 근거가 필요합니다.</p>
      </section>
      <details className="national-journal"><summary>다음 경기 예상 기록과 사후 확인 · {checks.length}/30건</summary>
        <p>사람이 작성하는 관찰 가설입니다. 결과를 보기 전에 대상 세트와 판정 기준을 적으세요. 이 브라우저에만 저장되며, 기기 시각은 사전 예측을 인증하지 않습니다. 공식 적중률에 합산하지 않습니다.</p>
        <div className="national-backup">
          <label>검증 기록 JSON 가져오기<input type="file" accept=".json,application/json" disabled={!ready || storageBlocked || importing} onChange={importChecks} /></label>
          <p>기존 기록에 합칩니다. 같은 기록의 예상·기준이 같으면 중복을 생략하고, 추가된 판정은 복원합니다. 예상이나 완료된 판정이 충돌하면 파일 전체를 취소합니다. 최대 30건 · 200KB.</p>
          {checks.length > 0 && <button type="button" onClick={exportChecks}>검증 기록 JSON 내보내기</button>}
        </div>
        <form onSubmit={freeze} className="national-check-form">
          <p>기록 대상: <b>{subject}</b></p>
          <label>대상 경기·세트<input required maxLength={160} value={target} placeholder="아직 결과를 보지 않은 경기 · 상대 · 세트" onChange={(event) => setTarget(event.target.value)} /></label>
          <label>예상<textarea required maxLength={500} value={hypothesis} placeholder="예: 서포터가 8분 전에 미드 교전에 합류한다." onChange={(event) => setHypothesis(event.target.value)} /></label>
          <label>판정 기준<textarea required maxLength={500} value={criterion} placeholder="예: 경기 시각 08:00 이전 미드에서 상대 챔피언과 교전. 단순 이동은 제외. 영상 누락이면 보류." onChange={(event) => setCriterion(event.target.value)} /></label>
          <button type="submit" disabled={!ready || storageBlocked || report.fixture_only || checks.length >= 30}>예상·기준 고정</button>
        </form><p role="status">{message}</p>
        {checks.map((check) => <article key={check.id} className="national-check">
          <h4>{check.subject} · {check.target}</h4><p>{check.hypothesis}</p><p>판정 기준: {check.criterion}</p>
          <p>기록 {check.created_at} · 당시 분석 {check.baseline.patch} / {check.baseline.cutoff.slice(0, 10)} · 기기 시각 미인증</p>
          {check.outcome ? <><b>{verdictLabels[check.outcome.verdict]}</b><p>{check.outcome.observation}</p><a href={check.outcome.source_url} target="_blank" rel="noreferrer">판정 근거</a></> : <OutcomeForm check={check} onResolve={(resolved) => { persist(checks.map((item) => item.id === resolved.id ? resolved : item)); setMessage("판정을 기록했습니다. 이는 수동 검토 결과입니다."); }} />}
        </article>)}
      </details>
      <p className="national-sources"><a href={review.schedule_source} target="_blank" rel="noreferrer">부산 공식 일정</a> · <a href={review.match_source} target="_blank" rel="noreferrer">선택 경기 보도</a>{review.lineup_source !== review.match_source && <> · <a href={review.lineup_source} target="_blank" rel="noreferrer">출전 관련 보도</a></>}</p>
    </div>
  </details>;
}
