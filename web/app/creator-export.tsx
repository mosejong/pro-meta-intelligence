"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { championSplashUrl } from "./champion-assets";
import { buildCreatorStoryboard, buildFallbackCreatorTopic, creatorStoryboardMarkdown, type CreatorBrief } from "./creator-storyboard";
import type { RadarEntry, RadarReport } from "./radar-types";
import { buildTeamDecisionCard } from "./team-brief";

export type CreatorAspect = "landscape" | "vertical";

export type CreatorScene = {
  schema_version: "1";
  artifact_type: "creator-visual-scene";
  aspect: CreatorAspect;
  patch_id: string;
  cutoff: string;
  champion_id: string;
  role: string;
  rank: number;
  title: string;
  hook: string;
  thumbnail_text: string;
  decision_label: string;
  evidence: Array<{ label: string; value: string }>;
  counterpoint: string;
  source_count: number;
  source_event_ids: string[];
  image_url: string;
  boundary: string;
};

const roleLabels: Record<string, string> = {
  TOP: "탑",
  JUNGLE: "정글",
  MID: "미드",
  BOTTOM: "바텀",
  SUPPORT: "서포터",
};

const canvasSizes: Record<CreatorAspect, { width: number; height: number }> = {
  landscape: { width: 1280, height: 720 },
  vertical: { width: 1080, height: 1920 },
};

function points(value: number) {
  const amount = value * 100;
  return `${amount > 0 ? "+" : amount < 0 ? "−" : ""}${Math.abs(amount).toFixed(1)}pp`;
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function creatorCanvasSize(aspect: CreatorAspect) {
  return canvasSizes[aspect];
}

export function buildCreatorScene(
  report: RadarReport,
  entry: RadarEntry,
  aspect: CreatorAspect,
): CreatorScene {
  const decision = buildTeamDecisionCard(entry);
  const role = roleLabels[entry.role] ?? entry.role;
  const bothRising = entry.metrics.demand_velocity > 0 && entry.metrics.pick_presence_delta > 0;
  const hook = bothRising
    ? `${entry.champion_id} ${role}은 최근 공개 경기에서 채택 팀과 픽 점유율이 함께 늘었습니다.`
    : `${entry.champion_id} ${role} 신호를 결론이 아니라 검토 후보로 분해합니다.`;

  return {
    schema_version: "1",
    artifact_type: "creator-visual-scene",
    aspect,
    patch_id: report.patch_id,
    cutoff: report.cutoff,
    champion_id: entry.champion_id,
    role,
    rank: entry.rank,
    title: `왜 ${entry.champion_id} ${role}을 지금 봐야 하나`,
    hook,
    thumbnail_text: `${entry.champion_id}\n지금 봐야 하는 이유`,
    decision_label: decision.decisionLabel,
    evidence: [
      { label: "팀 수요 변화", value: points(entry.metrics.demand_velocity) },
      { label: "픽 점유율 변화", value: points(entry.metrics.pick_presence_delta) },
      { label: "최근 채택 팀", value: `${entry.metrics.current_distinct_team_count}팀` },
      { label: "현재 픽 점유율", value: percent(entry.metrics.current_pick_presence) },
    ],
    counterpoint: decision.counterEvidence,
    source_count: entry.evidence_event_ids.length,
    source_event_ids: [...entry.evidence_event_ids],
    image_url: championSplashUrl(entry.champion_id),
    boundary: "공개 경기 관측을 영상 제작 장면으로 변환한 결과이며 출전 권고가 아닙니다.",
  };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    visible[maxLines - 1] = `${visible[maxLines - 1].replace(/[.…]+$/u, "")}…`;
  }
  visible.forEach((item, index) => context.fillText(item, x, y + index * lineHeight));
  return y + visible.length * lineHeight;
}

async function loadCanvasImage(url: string) {
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) throw new Error(`image returned ${response.status}`);
  return createImageBitmap(await response.blob());
}

function drawCover(
  context: CanvasRenderingContext2D,
  image: ImageBitmap,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const scale = Math.max(width / image.width, height / image.height);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  context.drawImage(
    image,
    (image.width - sourceWidth) / 2,
    (image.height - sourceHeight) / 2,
    sourceWidth,
    sourceHeight,
    x,
    y,
    width,
    height,
  );
}

async function renderCanvasFallback(scene: CreatorScene) {
  const { width, height } = creatorCanvasSize(scene.aspect);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D를 사용할 수 없습니다.");

  const vertical = scene.aspect === "vertical";
  const padding = vertical ? 72 : 58;
  const ink = "#101216";
  const paper = "#f5f2e9";
  const violet = "#6554ff";
  const signal = "#dfff61";
  context.fillStyle = paper;
  context.fillRect(0, 0, width, height);

  const imageArea = vertical
    ? { x: 0, y: 0, width, height: 760 }
    : { x: 760, y: 0, width: 520, height: 720 };
  context.fillStyle = violet;
  context.fillRect(imageArea.x, imageArea.y, imageArea.width, imageArea.height);
  try {
    const image = await loadCanvasImage(scene.image_url);
    context.save();
    context.globalAlpha = 0.9;
    drawCover(context, image, imageArea.x, imageArea.y, imageArea.width, imageArea.height);
    context.restore();
    image.close();
  } catch {
    context.fillStyle = violet;
    context.fillRect(imageArea.x, imageArea.y, imageArea.width, imageArea.height);
  }
  const gradient = vertical
    ? context.createLinearGradient(0, 350, 0, 780)
    : context.createLinearGradient(720, 0, 1060, 0);
  gradient.addColorStop(0, vertical ? "rgba(16,18,22,0)" : paper);
  gradient.addColorStop(1, vertical ? paper : "rgba(245,242,233,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, vertical ? 820 : height);

  const contentTop = vertical ? 730 : padding;
  const contentWidth = vertical ? width - padding * 2 : 690;
  context.fillStyle = ink;
  context.fillRect(padding, contentTop, vertical ? 285 : 250, vertical ? 52 : 38);
  context.fillStyle = signal;
  context.font = `800 ${vertical ? 24 : 17}px sans-serif`;
  context.fillText(`PATCH ${scene.patch_id} · SIGNAL #${String(scene.rank).padStart(2, "0")}`, padding + 16, contentTop + (vertical ? 34 : 26));

  let cursor = contentTop + (vertical ? 112 : 88);
  context.fillStyle = ink;
  context.font = `900 ${vertical ? 76 : 54}px sans-serif`;
  cursor = wrapText(context, scene.title, padding, cursor, contentWidth, vertical ? 88 : 62, 3);
  context.fillStyle = "#535755";
  context.font = `650 ${vertical ? 29 : 20}px sans-serif`;
  wrapText(context, scene.hook, padding, cursor + (vertical ? 20 : 12), contentWidth, vertical ? 44 : 30, vertical ? 2 : 3);

  const metricTop = vertical ? 1225 : 410;
  const metricGap = vertical ? 18 : 12;
  const metricWidth = (contentWidth - metricGap) / 2;
  scene.evidence.forEach((metric, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = padding + column * (metricWidth + metricGap);
    const y = metricTop + row * (vertical ? 150 : 100);
    context.fillStyle = index === 0 ? signal : "#ffffff";
    context.strokeStyle = ink;
    context.lineWidth = vertical ? 3 : 2;
    context.fillRect(x, y, metricWidth, vertical ? 130 : 86);
    context.strokeRect(x, y, metricWidth, vertical ? 130 : 86);
    context.fillStyle = "#555a58";
    context.font = `750 ${vertical ? 21 : 14}px sans-serif`;
    context.fillText(metric.label, x + (vertical ? 22 : 14), y + (vertical ? 36 : 24));
    context.fillStyle = ink;
    context.font = `900 ${vertical ? 48 : 30}px sans-serif`;
    context.fillText(metric.value, x + (vertical ? 22 : 14), y + (vertical ? 95 : 63));
  });

  if (vertical) {
    const counterTop = 1525;
    context.fillStyle = "#e8e4da";
    context.fillRect(padding, counterTop, contentWidth, 250);
    context.fillStyle = violet;
    context.font = "800 22px sans-serif";
    context.fillText("COUNTERPOINT", padding + 24, counterTop + 44);
    context.fillStyle = ink;
    context.font = "650 26px sans-serif";
    wrapText(context, scene.counterpoint, padding + 24, counterTop + 88, contentWidth - 48, 39, 4);
  } else {
    const counterX = 810;
    const counterY = 445;
    const counterWidth = 410;
    context.fillStyle = "rgba(232,228,218,.94)";
    context.fillRect(counterX, counterY, counterWidth, 185);
    context.strokeStyle = ink;
    context.lineWidth = 2;
    context.strokeRect(counterX, counterY, counterWidth, 185);
    context.fillStyle = violet;
    context.font = "800 14px sans-serif";
    context.fillText("COUNTERPOINT", counterX + 18, counterY + 29);
    context.fillStyle = ink;
    context.font = "650 18px sans-serif";
    wrapText(context, scene.counterpoint, counterX + 18, counterY + 62, counterWidth - 36, 27, 4);
  }

  context.fillStyle = ink;
  context.fillRect(0, height - (vertical ? 122 : 78), width, vertical ? 122 : 78);
  context.fillStyle = signal;
  context.font = `800 ${vertical ? 24 : 16}px sans-serif`;
  context.fillText("PRO META INTELLIGENCE", padding, height - (vertical ? 70 : 46));
  context.fillStyle = "#c8cbc8";
  context.font = `650 ${vertical ? 20 : 13}px sans-serif`;
  context.textAlign = "right";
  context.fillText(`공개 근거 ${scene.source_count}건 · 출전 권고 아님`, width - padding, height - (vertical ? 70 : 46));
  context.textAlign = "left";
  return canvas;
}

type ExperimentalCanvasContext = CanvasRenderingContext2D & {
  drawElementImage?: (element: Element, x?: number, y?: number, width?: number, height?: number) => DOMMatrix;
};

type ExperimentalCanvas = HTMLCanvasElement & { requestPaint?: () => void };

export function supportsHtmlInCanvas() {
  if (typeof document === "undefined") return false;
  const context = document.createElement("canvas").getContext("2d") as ExperimentalCanvasContext | null;
  return typeof context?.drawElementImage === "function";
}

function subscribeToCapability() {
  return () => undefined;
}

async function renderExperimentalHtml(source: HTMLElement, aspect: CreatorAspect) {
  const { width, height } = creatorCanvasSize(aspect);
  const canvas = document.createElement("canvas") as ExperimentalCanvas;
  canvas.width = width;
  canvas.height = height;
  canvas.setAttribute("layoutsubtree", "");
  Object.assign(canvas.style, {
    position: "fixed",
    left: "-20000px",
    top: "0",
    width: `${width}px`,
    height: `${height}px`,
  });
  const clone = source.cloneNode(true) as HTMLElement;
  clone.classList.add("export-resolution");
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  canvas.appendChild(clone);
  const context = canvas.getContext("2d") as ExperimentalCanvasContext | null;
  try {
    if (!context?.drawElementImage) throw new Error("HTML-in-Canvas 미지원");
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("HTML-in-Canvas paint timeout")), 1500);
      canvas.addEventListener("paint", () => {
        try {
          context.reset();
          context.drawElementImage?.(clone, 0, 0, width, height);
          window.clearTimeout(timeout);
          resolve();
        } catch (error) {
          reject(error);
        }
      }, { once: true });
      document.body.appendChild(canvas);
      canvas.requestPaint?.();
    });
    return canvas;
  } catch (error) {
    canvas.remove();
    throw error;
  }
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG 생성에 실패했습니다.")), "image/png");
  });
}

export function CreatorExportLab({ report, brief = null }: { report: RadarReport; brief?: CreatorBrief | null }) {
  const candidates = useMemo(
    () => report.entries.filter((entry) => entry.eligible_for_review).slice(0, 12),
    [report],
  );
  const topics = useMemo(() => {
    if (brief && brief.source_snapshot.patch_id === report.patch_id && brief.source_snapshot.cutoff === report.cutoff && brief.topic_candidates.length > 0) {
      return brief.topic_candidates;
    }
    return candidates.map((entry) => buildFallbackCreatorTopic(report, entry));
  }, [brief, candidates, report]);
  const [selectedKey, setSelectedKey] = useState("");
  const [selectedTitle, setSelectedTitle] = useState("");
  const [activeSceneIndex, setActiveSceneIndex] = useState(1);
  const [reviewChecks, setReviewChecks] = useState<string[]>([]);
  const [aspect, setAspect] = useState<CreatorAspect>("landscape");
  const htmlCanvasReady = useSyncExternalStore(
    subscribeToCapability,
    supportsHtmlInCanvas,
    () => false,
  );
  const [status, setStatus] = useState("내보낼 장면을 확인하세요.");
  const sceneRef = useRef<HTMLElement>(null);
  const selectedTopic = topics.find((topic) => topic.candidate_id === selectedKey) ?? topics[0];
  const selected = selectedTopic
    ? report.entries.find((entry) => `${entry.champion_id}:${entry.role}` === selectedTopic.candidate_id) ?? candidates[0]
    : candidates[0];
  const scene = selected ? buildCreatorScene(report, selected, aspect) : null;
  const storyboardTitle = selectedTopic?.title_candidates.includes(selectedTitle) ? selectedTitle : selectedTopic?.title_candidates[0];
  const storyboard = selectedTopic ? buildCreatorStoryboard(
    report,
    selectedTopic,
    storyboardTitle,
    brief?.source_snapshot.source_versions ?? [],
  ) : null;
  const activeScene = storyboard?.scenes.find((item) => item.index === activeSceneIndex) ?? storyboard?.scenes[0];
  const reviewItems = ["수치와 패치 확인", "반론 유지 확인", "출처 목록 확인"];

  async function exportPng() {
    if (!scene || !sceneRef.current) return;
    setStatus("PNG 장면을 렌더링하는 중…");
    let canvas: HTMLCanvasElement | null = null;
    try {
      canvas = await renderExperimentalHtml(sceneRef.current, aspect);
      const blob = await canvasBlob(canvas);
      downloadBlob(blob, `pmi-${scene.champion_id.replace(/[^A-Za-z0-9_-]+/g, "-")}-${aspect}.png`);
      setStatus("HTML-in-Canvas로 PNG 저장 완료");
    } catch {
      canvas?.remove();
      try {
        canvas = await renderCanvasFallback(scene);
        downloadBlob(
          await canvasBlob(canvas),
          `pmi-${scene.champion_id.replace(/[^A-Za-z0-9_-]+/g, "-")}-${aspect}.png`,
        );
        setStatus("Canvas fallback으로 PNG 저장 완료");
      } catch {
        setStatus("PNG 생성 실패 · 장면 JSON을 사용하세요.");
      }
    } finally {
      canvas?.remove();
    }
  }

  function exportJson() {
    if (!scene) return;
    downloadBlob(
      new Blob([`${JSON.stringify(scene, null, 2)}\n`], { type: "application/json" }),
      `pmi-${scene.champion_id.replace(/[^A-Za-z0-9_-]+/g, "-")}-${aspect}.json`,
    );
    setStatus("장면 JSON 저장 완료");
  }

  function exportStoryboardJson() {
    if (!storyboard) return;
    downloadBlob(
      new Blob([`${JSON.stringify(storyboard, null, 2)}\n`], { type: "application/json" }),
      `pmi-storyboard-${storyboard.champion_id.replace(/[^A-Za-z0-9_-]+/g, "-")}-${report.patch_id}.json`,
    );
    setStatus("5장 스토리보드 JSON 저장 완료");
  }

  function exportStoryboardMarkdown() {
    if (!storyboard) return;
    downloadBlob(
      new Blob([creatorStoryboardMarkdown(storyboard)], { type: "text/markdown;charset=utf-8" }),
      `pmi-storyboard-${storyboard.champion_id.replace(/[^A-Za-z0-9_-]+/g, "-")}-${report.patch_id}.md`,
    );
    setStatus("대본 패킷 Markdown 저장 완료");
  }

  async function copyShortScript() {
    if (!storyboard) return;
    try {
      await navigator.clipboard.writeText(storyboard.short_form_script);
      setStatus("쇼츠 대본 복사 완료");
    } catch {
      setStatus("복사 실패 · Markdown으로 저장하세요.");
    }
  }

  function toggleReviewCheck(item: string) {
    setReviewChecks((current) => current.includes(item) ? current.filter((value) => value !== item) : [...current, item]);
  }

  if (!scene || !storyboard || !activeScene) return null;

  return <section className="creator-export" id="creator-export">
    <header className="creator-export-head">
      <div><p className="eyebrow">03 · CREATOR EXPORT LAB</p><h2>분석을 바로 영상 장면으로.</h2><p>데이터 카드와 반론을 같은 근거 계약에서 만들고, 유튜브·쇼츠용 PNG 또는 장면 JSON으로 내보냅니다.</p></div>
      <span className={htmlCanvasReady ? "experimental" : "fallback"}><i />{htmlCanvasReady ? "HTML-IN-CANVAS READY" : "CANVAS FALLBACK READY"}</span>
    </header>
    <div className="creator-export-controls">
      <label>분석 후보<select value={selectedTopic?.candidate_id ?? ""} onChange={(event) => { setSelectedKey(event.target.value); setSelectedTitle(""); setActiveSceneIndex(1); setReviewChecks([]); }}>{topics.map((topic) => <option key={topic.candidate_id} value={topic.candidate_id}>#{topic.radar_rank} · {topic.champion_id} · {roleLabels[topic.role] ?? topic.role}</option>)}</select></label>
      <fieldset><legend>출력 비율</legend><button type="button" className={aspect === "landscape" ? "active" : ""} onClick={() => setAspect("landscape")}>16:9 유튜브</button><button type="button" className={aspect === "vertical" ? "active" : ""} onClick={() => setAspect("vertical")}>9:16 쇼츠</button></fieldset>
      <div className="creator-export-actions"><button type="button" onClick={() => void exportPng()}>PNG 저장</button><button type="button" onClick={exportJson}>장면 JSON</button></div>
    </div>

    <section className="creator-storyboard" aria-labelledby="creator-storyboard-title">
      <header>
        <div><span>STORYBOARD V1 · CLAIM LOCKED</span><h3 id="creator-storyboard-title">한 후보를 영상 한 편으로.</h3><p>승인된 주장과 반론을 Hook → 근거 → 의미 → 반론 → 다음 확인 순서로 배열했습니다.</p></div>
        <dl><div><dt>SCENES</dt><dd>{storyboard.scenes.length}</dd></div><div><dt>RUN TIME</dt><dd>{Math.round(storyboard.estimated_duration_seconds / 60)}분</dd></div><div><dt>SOURCES</dt><dd>{storyboard.source_event_ids.length}</dd></div></dl>
      </header>
      <div className="creator-title-picker">
        <label>영상 제목<select value={storyboard.title} onChange={(event) => setSelectedTitle(event.target.value)}>{storyboard.title_candidates.map((title) => <option key={title} value={title}>{title}</option>)}</select></label>
        <div><span>THUMBNAIL</span><strong>{storyboard.thumbnail_copy.join(" / ")}</strong></div>
        <b>{brief ? "PUBLISHED CREATOR BRIEF" : "RADAR FALLBACK BRIEF"}</b>
      </div>
      <nav className="creator-storyboard-timeline" aria-label="영상 장면 순서">
        {storyboard.scenes.map((item) => <button key={item.index} type="button" className={activeScene.index === item.index ? "active" : ""} onClick={() => setActiveSceneIndex(item.index)} aria-pressed={activeScene.index === item.index}><b>{String(item.index).padStart(2, "0")}</b><span>{item.timecode}</span><strong>{item.label}</strong><small>{item.duration_seconds}초</small></button>)}
      </nav>
      <div className="creator-storyboard-detail">
        <article>
          <header><span>{activeScene.chapter}</span><b>{activeScene.timecode} · {activeScene.duration_seconds}초</b></header>
          <h4>{activeScene.title}</h4>
          <div><span>VOICEOVER</span><p>{activeScene.voiceover}</p></div>
          <footer><span>화면 지시</span><p>{activeScene.visual_direction}</p></footer>
        </article>
        <aside>
          <span>ON-SCREEN COPY</span><p>{activeScene.on_screen}</p>
          <div><span>CLAIM IDS</span>{activeScene.claim_ids.length ? activeScene.claim_ids.map((claimId) => <code key={claimId}>{claimId}</code>) : <code>COUNTERPOINT / BOUNDARY</code>}</div>
        </aside>
      </div>
      <div className="creator-script-packet">
        <section><span>SHORTS · 30–60 SEC</span><h4>짧은 대본</h4><p>{storyboard.short_form_script}</p><button type="button" onClick={() => void copyShortScript()}>쇼츠 대본 복사</button></section>
        <section className="creator-review-gate"><span>HUMAN REVIEW GATE</span><h4>{reviewChecks.length} / {reviewItems.length} 편집 확인</h4>{reviewItems.map((item) => <label key={item}><input type="checkbox" checked={reviewChecks.includes(item)} onChange={() => toggleReviewCheck(item)} />{item}</label>)}<b>{reviewChecks.length === reviewItems.length ? "편집 검토 완료 · 수동 발행 판단" : "검토 전 · 발행 불가"}</b></section>
        <section className="creator-packet-actions"><span>EDITOR HANDOFF</span><h4>제작 파일</h4><button type="button" onClick={exportStoryboardMarkdown}>대본 Markdown</button><button type="button" onClick={exportStoryboardJson}>스토리보드 JSON</button><small>브라우저에서만 생성 · 서버 업로드 없음</small></section>
      </div>
      <footer className="creator-storyboard-boundary"><b>{storyboard.review_state}</b><p>{storyboard.boundary}</p></footer>
    </section>

    <div className={`creator-stage ${aspect}`}>
      <article ref={sceneRef} className={`creator-scene ${aspect}`} style={{ backgroundImage: `linear-gradient(${aspect === "vertical" ? "0deg" : "90deg"}, #f5f2e9 ${aspect === "vertical" ? "45%" : "44%"}, transparent ${aspect === "vertical" ? "70%" : "76%"}), url(${scene.image_url})` }}>
        <span className="creator-scene-tag">PATCH {scene.patch_id} · SIGNAL #{String(scene.rank).padStart(2, "0")}</span>
        <div className="creator-scene-copy"><h3>{scene.title}</h3><p>{scene.hook}</p></div>
        <div className="creator-scene-metrics">{scene.evidence.map((metric) => <div key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong></div>)}</div>
        <aside><span>COUNTERPOINT</span><p>{scene.counterpoint}</p></aside>
        <footer><b>PRO META INTELLIGENCE</b><span>공개 근거 {scene.source_count}건 · 출전 권고 아님</span></footer>
      </article>
    </div>
    <footer className="creator-export-status"><span>{status}</span><b>실험 API 미지원 시 자동 fallback · 서버 업로드 없음</b></footer>
  </section>;
}
