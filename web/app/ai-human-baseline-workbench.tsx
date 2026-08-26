"use client";

/* eslint-disable @next/next/no-img-element -- champion portraits use the pinned Riot Data Dragon version */

import { useEffect, useMemo, useRef, useState } from "react";
import { championImageUrl } from "./champion-assets";
import { useChampionNames } from "./champion-names";
import {
  AI_HUMAN_BASELINE_STORAGE_KEY,
  baselineBoundaryOptions,
  baselineClaimOptions,
  baselineCriticalErrorOptions,
  createAIHumanBaselineDraft,
  exportAIHumanBaselineBundle,
  humanBaselineAvailableEvidenceIds,
  humanBaselineTaskKey,
  parseAIHumanBaselineDrafts,
  serializeAIHumanBaselineDrafts,
  upsertAIHumanBaselineDraft,
  type AIHumanBaselineDraft,
} from "./ai-human-baseline";
import type { RadarReport } from "./radar-types";

const roleLabels: Record<string, string> = {
  TOP: "탑",
  JUNGLE: "정글",
  MID: "미드",
  BOTTOM: "바텀",
  SUPPORT: "서포터",
};

function percent(value: number | null) {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function toggle(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function download(value: string, fileName: string) {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(new Blob([value], { type: "application/json;charset=utf-8" }));
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

export function AIHumanBaselineWorkbench({ report }: { report: RadarReport }) {
  const { nameOf } = useChampionNames();
  const [drafts, setDrafts] = useState<AIHumanBaselineDraft[]>([]);
  const [ready, setReady] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [active, setActive] = useState(false);
  const [claimIds, setClaimIds] = useState<string[]>([]);
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [boundaryIds, setBoundaryIds] = useState<string[]>([]);
  const [criticalErrorIds, setCriticalErrorIds] = useState<string[]>([]);
  const [acceptedWithoutEdit, setAcceptedWithoutEdit] = useState(false);
  const [activeTaskKey, setActiveTaskKey] = useState("");
  const [message, setMessage] = useState("");
  const startedAt = useRef(0);

  useEffect(() => {
    const restore = window.setTimeout(() => {
      try {
        setDrafts(parseAIHumanBaselineDrafts(window.localStorage.getItem(AI_HUMAN_BASELINE_STORAGE_KEY)));
        setStorageAvailable(true);
      } catch {
        setStorageAvailable(false);
      } finally {
        setReady(true);
      }
    }, 0);
    return () => window.clearTimeout(restore);
  }, []);

  const taskEntries = useMemo(() => report.entries.filter((entry) => entry.evidence_event_ids.length > 0), [report.entries]);
  const nextEntry = taskEntries.find((entry) => !drafts.some((draft) => draft.task_key === humanBaselineTaskKey(report, entry)));
  const currentEntry = active
    ? taskEntries.find((entry) => humanBaselineTaskKey(report, entry) === activeTaskKey)
    : nextEntry;
  const completedForSnapshot = drafts.filter((draft) => draft.snapshot.cutoff === report.cutoff).length;
  const canSave = Boolean(active && currentEntry && claimIds.length && evidenceIds.length && boundaryIds.length && storageAvailable);

  function begin() {
    setClaimIds([]);
    setEvidenceIds([]);
    setBoundaryIds([]);
    setCriticalErrorIds([]);
    if (!currentEntry) return;
    setAcceptedWithoutEdit(false);
    setActiveTaskKey(humanBaselineTaskKey(report, currentEntry));
    setMessage("");
    startedAt.current = new Date().getTime();
    setActive(true);
  }

  function save() {
    if (!currentEntry || !canSave) return;
    try {
      const savedAt = new Date().toISOString();
      const draft = createAIHumanBaselineDraft({
        report,
        entry: currentEntry,
        draftId: `baseline-${savedAt}-${currentEntry.champion_id}-${currentEntry.role}`,
        savedAt,
        claimIds,
        evidenceIds,
        boundaryIds,
        criticalErrorIds,
        durationSeconds: (new Date().getTime() - startedAt.current) / 1000,
        acceptedWithoutEdit,
      });
      const next = upsertAIHumanBaselineDraft(drafts, draft);
      window.localStorage.setItem(AI_HUMAN_BASELINE_STORAGE_KEY, serializeAIHumanBaselineDrafts(next));
      setDrafts(next);
      setActive(false);
      setActiveTaskKey("");
      setMessage("사람 기준선 1건을 이 기기에만 저장했습니다.");
    } catch {
      setStorageAvailable(false);
      setMessage("기기 저장소를 사용할 수 없어 기록하지 못했습니다.");
    }
  }

  function exportDrafts() {
    if (!drafts.length) return;
    download(exportAIHumanBaselineBundle(drafts, new Date().toISOString()), `pmi-human-baseline-${drafts.length}.json`);
    setMessage("익명 기준선 묶음을 내보냈습니다. 아직 AI 평가 입력은 아닙니다.");
  }

  function clearDrafts() {
    if (!drafts.length || !window.confirm("이 기기에 저장된 사람 기준선 기록을 모두 삭제할까요? 내보내지 않은 기록은 복구할 수 없습니다.")) return;
    try {
      window.localStorage.removeItem(AI_HUMAN_BASELINE_STORAGE_KEY);
      setDrafts([]);
      setActive(false);
      setActiveTaskKey("");
      setMessage("기기 로컬 기록을 삭제했습니다.");
    } catch {
      setStorageAvailable(false);
    }
  }

  return <section className="human-baseline" aria-labelledby="human-baseline-title">
    <header>
      <div><span>STEP 1 · HUMAN BASELINE</span><h3 id="human-baseline-title">AI와 비교할 사람 기준선부터 모으기</h3><p>정답과 AI 출력은 보여주지 않습니다. 같은 공개 근거를 보고 사람이 고른 주장·근거·한계와 실제 판단 시간만 기록합니다.</p></div>
      <div className="human-baseline-progress"><strong>{drafts.length}<small>/30 초안</small></strong><span>현재 스냅샷 {completedForSnapshot}건</span></div>
    </header>

    {!ready ? <div className="human-baseline-empty">기기 로컬 기록을 확인하는 중입니다.</div> : !storageAvailable ? <div className="human-baseline-empty"><b>기기 저장소를 사용할 수 없습니다.</b><span>개인정보 보호 설정에서 로컬 저장을 허용해야 기준선 기록을 남길 수 있습니다.</span></div> : active && currentEntry ? <div className="human-baseline-task">
      <article className="human-task-brief">
        <div className="human-task-champion"><img src={championImageUrl(currentEntry.champion_id)} alt="" /><div><span>숨김 비교 과제 · #{String(currentEntry.rank).padStart(2, "0")}</span><h4>{nameOf(currentEntry.champion_id)} · {roleLabels[currentEntry.role] ?? currentEntry.role}</h4><small>패치 {report.patch_id} · 공개 근거 {currentEntry.evidence_event_ids.length}건</small></div></div>
        <dl><div><dt>최근 픽 점유율</dt><dd>{percent(currentEntry.metrics.current_pick_presence)}</dd></div><div><dt>이전 대비</dt><dd>{percent(currentEntry.metrics.pick_presence_delta)}</dd></div><div><dt>관측 팀</dt><dd>{currentEntry.metrics.current_distinct_team_count}팀</dd></div><div><dt>지역 차이</dt><dd>{percent(currentEntry.metrics.regional_divergence)}</dd></div></dl>
        <p>활성 판단 시간은 시작 버튼을 누른 시점부터 저장할 때까지 자동 측정됩니다. 이름·계정·API 키는 기록하지 않습니다.</p>
      </article>

      <form onSubmit={(event) => { event.preventDefault(); save(); }}>
        <fieldset><legend>1. 근거로 말할 수 있는 주장</legend>{baselineClaimOptions.map((option) => <label key={option.id}><input type="checkbox" checked={claimIds.includes(option.id)} onChange={() => setClaimIds(toggle(claimIds, option.id))} /><span>{option.label}</span></label>)}</fieldset>
        <fieldset><legend>2. 그 판단에 직접 쓴 근거</legend><div className="human-evidence-options">{humanBaselineAvailableEvidenceIds(currentEntry).map((id, index) => <label key={id}><input type="checkbox" checked={evidenceIds.includes(id)} onChange={() => setEvidenceIds(toggle(evidenceIds, id))} /><span>근거 {String(index + 1).padStart(2, "0")}<code>{id}</code></span></label>)}</div></fieldset>
        <fieldset><legend>3. 반드시 남길 해석 한계</legend>{baselineBoundaryOptions.map((option) => <label key={option.id}><input type="checkbox" checked={boundaryIds.includes(option.id)} onChange={() => setBoundaryIds(toggle(boundaryIds, option.id))} /><span>{option.label}</span></label>)}</fieldset>
        <details><summary>제출 전 치명적 오류를 발견했나요?</summary>{baselineCriticalErrorOptions.map((option) => <label key={option.id}><input type="checkbox" checked={criticalErrorIds.includes(option.id)} onChange={() => setCriticalErrorIds(toggle(criticalErrorIds, option.id))} /><span>{option.label}</span></label>)}</details>
        <label className="human-edit-check"><input type="checkbox" checked={acceptedWithoutEdit} onChange={(event) => setAcceptedWithoutEdit(event.target.checked)} /><span>최종 검토에서 판단을 다시 고치지 않았다</span></label>
        <div className="human-task-actions"><button type="button" onClick={() => { setActive(false); setActiveTaskKey(""); }}>중단</button><button type="submit" disabled={!canSave}>사람 기준선 저장</button></div>
      </form>
    </div> : <div className="human-baseline-start">
      <div><b>{active ? "과제 도중 데이터 스냅샷이 갱신됐습니다." : currentEntry ? "다음 미완료 과제가 준비됐습니다." : "현재 스냅샷의 과제를 모두 기록했습니다."}</b><p>{active ? "이전 스냅샷과 새 근거를 섞지 않도록 진행 중 과제를 중단했습니다." : currentEntry ? "AI 답변 없이 먼저 판단해 실제 사람 정확도와 시간을 비교할 수 있게 만듭니다." : "새 공개 데이터 스냅샷이 발행되면 새로운 과제가 자동으로 생깁니다."}</p></div>
      <button type="button" onClick={active ? () => { setActive(false); setActiveTaskKey(""); } : begin} disabled={!currentEntry && !active}>{active ? "새 과제 준비" : drafts.length ? "다음 사람 기준선 시작" : "첫 사람 기준선 시작"}</button>
    </div>}

    <footer><div><b>아직 AI 평가에 포함되지 않음</b><p>30개 초안은 수집 목표일 뿐입니다. 전문가가 잠근 정답과 동일 과제의 AI 출력을 오프라인에서 결합하기 전에는 공개 0/30과 AI 잠금 상태가 바뀌지 않습니다.</p></div><span>{message}</span><nav><button type="button" onClick={exportDrafts} disabled={!drafts.length}>익명 JSON 내보내기</button><button type="button" onClick={clearDrafts} disabled={!drafts.length}>기기 기록 삭제</button></nav></footer>
  </section>;
}
