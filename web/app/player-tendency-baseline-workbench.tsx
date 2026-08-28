"use client";

/* eslint-disable @next/next/no-img-element -- champion portraits use the pinned Riot CDN */

import { useEffect, useMemo, useRef, useState } from "react";
import { championImageUrl } from "./champion-assets";
import { useChampionNames } from "./champion-names";
import {
  buildPlayerTendencyHoldoutTasks,
  createPlayerTendencyBaselineDraft,
  exportPlayerTendencyBaselineBundle,
  PLAYER_TENDENCY_BASELINE_STORAGE_KEY,
  PLAYER_TENDENCY_HOLDOUT_TARGET,
  parsePlayerTendencyBaselineDrafts,
  serializePlayerTendencyBaselineDrafts,
  tendencyBaselineBoundaryOptions,
  tendencyBaselineClaimOptions,
  tendencyBaselineCriticalErrorOptions,
  tendencyScenarioLabels,
  upsertPlayerTendencyBaselineDraft,
  type PlayerTendencyBaselineDraft,
} from "./player-tendency-baseline";
import type { RadarReport } from "./radar-types";

const roleLabels: Record<string, string> = {
  TOP: "탑",
  JUNGLE: "정글",
  MID: "미드",
  BOTTOM: "바텀",
  SUPPORT: "서포터",
};

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

export function PlayerTendencyBaselineWorkbench({ report }: { report: RadarReport }) {
  const { nameOf } = useChampionNames();
  const tasks = useMemo(() => buildPlayerTendencyHoldoutTasks(report), [report]);
  const taskKeys = useMemo(() => new Set(tasks.map((task) => task.task_key)), [tasks]);
  const [drafts, setDrafts] = useState<PlayerTendencyBaselineDraft[]>([]);
  const [ready, setReady] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [active, setActive] = useState(false);
  const [activeTaskKey, setActiveTaskKey] = useState("");
  const [claimIds, setClaimIds] = useState<string[]>([]);
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [boundaryIds, setBoundaryIds] = useState<string[]>([]);
  const [criticalErrorIds, setCriticalErrorIds] = useState<string[]>([]);
  const [acceptedWithoutEdit, setAcceptedWithoutEdit] = useState(false);
  const [message, setMessage] = useState("");
  const startedAt = useRef(0);

  useEffect(() => {
    const restore = window.setTimeout(() => {
      try {
        setDrafts(parsePlayerTendencyBaselineDrafts(window.localStorage.getItem(PLAYER_TENDENCY_BASELINE_STORAGE_KEY)));
      } catch {
        setStorageAvailable(false);
      } finally {
        setReady(true);
      }
    }, 0);
    return () => window.clearTimeout(restore);
  }, []);

  const snapshotDrafts = drafts.filter((draft) => draft.snapshot.cutoff === report.cutoff && taskKeys.has(draft.task_key));
  const nextTask = tasks.find((task) => !snapshotDrafts.some((draft) => draft.task_key === task.task_key));
  const currentTask = active ? tasks.find((task) => task.task_key === activeTaskKey) : nextTask;
  const deckReady = tasks.length === PLAYER_TENDENCY_HOLDOUT_TARGET;
  const canSave = Boolean(active && currentTask && claimIds.length && evidenceIds.length && boundaryIds.length && storageAvailable);
  const leadChampion = currentTask?.task.subject.champions[0];

  function begin() {
    if (!nextTask || !deckReady) return;
    setClaimIds([]);
    setEvidenceIds([]);
    setBoundaryIds([]);
    setCriticalErrorIds([]);
    setAcceptedWithoutEdit(false);
    setActiveTaskKey(nextTask.task_key);
    setMessage("");
    startedAt.current = new Date().getTime();
    setActive(true);
  }

  function stop() {
    setActive(false);
    setActiveTaskKey("");
  }

  function save() {
    if (!currentTask || !canSave) return;
    let draft: PlayerTendencyBaselineDraft;
    try {
      const savedAt = new Date().toISOString();
      draft = createPlayerTendencyBaselineDraft({
        task: currentTask,
        draftId: `player-tendency-${savedAt}-${currentTask.snapshot.scenario}-${currentTask.snapshot.role}`,
        savedAt,
        claimIds,
        evidenceIds,
        boundaryIds,
        criticalErrorIds,
        durationSeconds: (new Date().getTime() - startedAt.current) / 1000,
        acceptedWithoutEdit,
      });
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "기준선 형식을 확인하지 못했습니다.");
      return;
    }
    try {
      const next = upsertPlayerTendencyBaselineDraft(drafts, draft);
      window.localStorage.setItem(PLAYER_TENDENCY_BASELINE_STORAGE_KEY, serializePlayerTendencyBaselineDrafts(next));
      setDrafts(next);
      stop();
      setMessage("선수 성향 사람 기준선 1건을 이 기기에만 저장했습니다.");
    } catch {
      setStorageAvailable(false);
      setMessage("기기 저장소를 사용할 수 없어 기록하지 못했습니다.");
    }
  }

  function exportDrafts() {
    if (!snapshotDrafts.length) return;
    download(
      exportPlayerTendencyBaselineBundle(snapshotDrafts, new Date().toISOString()),
      `pmi-player-tendency-human-${snapshotDrafts.length}.json`,
    );
    setMessage("현재 스냅샷의 익명 선수 성향 기준선만 내보냈습니다.");
  }

  function clearDrafts() {
    if (!drafts.length || !window.confirm("이 기기에 저장된 선수 성향 기준선 기록을 모두 삭제할까요? 내보내지 않은 기록은 복구할 수 없습니다.")) return;
    try {
      window.localStorage.removeItem(PLAYER_TENDENCY_BASELINE_STORAGE_KEY);
      setDrafts([]);
      stop();
      setMessage("선수 성향 기기 로컬 기록을 삭제했습니다.");
    } catch {
      setStorageAvailable(false);
    }
  }

  return <section className="human-baseline tendency-human-baseline" id="player-tendency-holdout" aria-labelledby="player-tendency-holdout-title">
    <header>
      <div><span>PLAYER BOT HOLDOUT · HUMAN FIRST</span><h3 id="player-tendency-holdout-title">선수 성향봇 30개 사람 기준선</h3><p>T1 중심 6개 시나리오를 포지션별로 반복해 정확한 답뿐 아니라 반드시 거절해야 할 질문까지 측정합니다. 답변·정답·AI 출력은 서로 분리됩니다.</p></div>
      <div className="human-baseline-progress"><strong>{snapshotDrafts.length}<small>/{PLAYER_TENDENCY_HOLDOUT_TARGET} 초안</small></strong><span>균형 과제 {tasks.length}/{PLAYER_TENDENCY_HOLDOUT_TARGET}</span></div>
    </header>

    <div className="tendency-scenario-mix" aria-label="평가 시나리오 구성">{Object.entries(tendencyScenarioLabels).map(([id, label]) => <span key={id}><b>5</b>{label}</span>)}</div>

    {!ready ? <div className="human-baseline-empty">기기 로컬 선수 성향 기준선을 확인하는 중입니다.</div>
      : !storageAvailable ? <div className="human-baseline-empty"><b>기기 저장소를 사용할 수 없습니다.</b><span>이 기준선은 서버가 아니라 현재 기기의 임시 초안으로만 보관됩니다.</span></div>
        : !deckReady ? <div className="human-baseline-empty"><b>균형 평가 덱이 완성되지 않았습니다.</b><span>T1·Gen.G 현재 로스터와 포지션별 공개 근거가 모두 있어야 30개 작성을 시작합니다. 현재 {tasks.length}/30.</span></div>
          : active && currentTask ? <div className="human-baseline-task">
            <article className="human-task-brief">
              <div className="human-task-champion">{leadChampion ? <img src={championImageUrl(leadChampion.champion_id)} alt="" /> : <span />}
                <div><span>{tendencyScenarioLabels[currentTask.task.scenario]} · {roleLabels[currentTask.snapshot.role] ?? currentTask.snapshot.role}</span><h4>{currentTask.task.subject.player_name}</h4><small>{currentTask.task.subject.team_name} · 패치 {currentTask.snapshot.patch_id} · {currentTask.task.subject.game_count}G</small></div>
              </div>
              <blockquote className="tendency-task-question">“{currentTask.task.question}”</blockquote>
              <dl><div><dt>공개 표본</dt><dd>{currentTask.task.subject.game_count}G</dd></div><div><dt>반복 1순위</dt><dd>{leadChampion ? nameOf(leadChampion.champion_id) : "—"}</dd></div><div><dt>비교 선수</dt><dd>{currentTask.task.comparison?.player_name ?? "없음"}</dd></div><div><dt>근거·정책</dt><dd>{currentTask.task.available_evidence_ids.length}개</dd></div></dl>
              <p>판단 시간은 과제 시작부터 저장까지 자동 측정합니다. 실제 개인 연습값, 계정, 분석가 이름, API 키는 수집하지 않습니다.</p>
            </article>

            <form onSubmit={(event) => { event.preventDefault(); save(); }}>
              <fieldset><legend>1. 이 질문에서 허용할 주장</legend>{tendencyBaselineClaimOptions.map((option) => <label key={option.id}><input type="checkbox" checked={claimIds.includes(option.id)} onChange={() => setClaimIds(toggle(claimIds, option.id))} /><span>{option.label}</span></label>)}</fieldset>
              <fieldset><legend>2. 직접 사용한 근거·정책 ID</legend><div className="human-evidence-options">{currentTask.task.available_evidence_ids.map((id, index) => <label key={id}><input type="checkbox" checked={evidenceIds.includes(id)} onChange={() => setEvidenceIds(toggle(evidenceIds, id))} /><span>{id.startsWith("POLICY:") ? "정책 경계" : `공개 근거 ${String(index + 1).padStart(2, "0")}`}<code>{id}</code></span></label>)}</div></fieldset>
              <fieldset><legend>3. 반드시 유지할 분석 경계</legend>{tendencyBaselineBoundaryOptions.map((option) => <label key={option.id}><input type="checkbox" checked={boundaryIds.includes(option.id)} onChange={() => setBoundaryIds(toggle(boundaryIds, option.id))} /><span>{option.label}</span></label>)}</fieldset>
              <details><summary>제출 전 치명적 오류를 발견했나요?</summary>{tendencyBaselineCriticalErrorOptions.map((option) => <label key={option.id}><input type="checkbox" checked={criticalErrorIds.includes(option.id)} onChange={() => setCriticalErrorIds(toggle(criticalErrorIds, option.id))} /><span>{option.label}</span></label>)}</details>
              <label className="human-edit-check"><input type="checkbox" checked={acceptedWithoutEdit} onChange={(event) => setAcceptedWithoutEdit(event.target.checked)} /><span>최종 검토에서 이 판단을 다시 고치지 않았다</span></label>
              <div className="human-task-actions"><button type="button" onClick={stop}>중단</button><button type="submit" disabled={!canSave}>사람 기준선 저장</button></div>
            </form>
          </div> : <div className="human-baseline-start">
            <div><b>{nextTask ? "다음 균형 과제가 준비됐습니다." : "현재 선수 성향 평가 덱 30개를 모두 작성했습니다."}</b><p>{nextTask ? "AI 답변을 보지 않은 상태에서 주장·근거·경계를 먼저 선택해야 사람 대비 성능을 정직하게 비교할 수 있습니다." : "익명 JSON을 내보낸 뒤 전문가 정답과 AI 출력을 서로 분리해 작성합니다."}</p></div>
            <button type="button" onClick={begin} disabled={!nextTask}>{snapshotDrafts.length ? "다음 선수 성향 과제" : "첫 선수 성향 과제"}</button>
          </div>}

    <footer><div><b>공개 AI 상태에는 아직 반영되지 않음</b><p>30개 초안은 사람 기준선 수집 완료일 뿐입니다. 블라인드 전문가 정답과 동일 과제의 고정 AI 출력이 결합되기 전까지 공개 상태는 0/30과 AI 잠금을 유지합니다.</p></div><span>{message}</span><nav><button type="button" onClick={exportDrafts} disabled={!snapshotDrafts.length}>현재 스냅샷 JSON</button><button type="button" onClick={clearDrafts} disabled={!drafts.length}>기기 기록 삭제</button></nav></footer>
  </section>;
}
