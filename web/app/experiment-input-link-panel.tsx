"use client";

import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ASSUMPTION_FIELDS, sourceTeamOrder, type AssumptionField, type ExperimentRun } from "./experiment-replay";
import type { SimulationInputSnapshot } from "./simulation-scenario";
import {
  createExperimentInputLink,
  EXPERIMENT_LINK_SCOPE,
  parseExperimentInputLink,
  planExperimentLinkApply,
  plainDecimal,
  type ApplyPlan,
  type GateRefusal,
  type LinkRefusal,
} from "./experiment-input-link";

type Props = {
  /** Current frozen run of this page, or null. */
  run: ExperimentRun | null;
  /** Shown minute of that run; the link can only be copied at its end. */
  shownMinute: number | null;
  readyInput: SimulationInputSnapshot | null;
  blocked: boolean;
  /** Fills only the two teams' assumption texts and the seed text. Never runs the model. */
  onApply: (plan: Extract<ApplyPlan, { ok: true }>) => void;
};

type CopyState = { run: ExperimentRun; href: string; url: string; status: "copying" | "copied" | "manual" };

const fieldLabels: Record<AssumptionField, string> = { lane: "라인", tempo: "운영", teamfight: "한타" };
const linkRefusalText: Partial<Record<LinkRefusal, string>> = {
  NOT_TRUSTED: "이 화면에서 만든 실행이 아니어서 링크를 만들 수 없습니다.",
  NOT_COMPLETE: "결과까지 확인한 실행만 가정값 링크를 만들 수 있습니다.",
  UNSAFE_ORIGIN: "안전한 주소(HTTPS 또는 이 컴퓨터)에서만 링크를 만들 수 있습니다.",
  TOO_LONG: "링크가 너무 깁니다.",
  TOO_LARGE: "링크 내용이 허용 크기를 넘었습니다.",
  BAD_VERSION: "지원하지 않는 가정값 링크 버전입니다.",
  BAD_RULESET: "이 모델 규칙과 다른 링크입니다.",
};
const gateText: Record<GateRefusal, string> = {
  BLOCKED: "방 연결·파일 복원·자료 로딩 중에는 적용할 수 없습니다.",
  NO_READY_INPUT: "위 시뮬레이션 입력 준비가 완료되어야 적용할 수 있습니다. 빈 자리를 임의로 채우지 않습니다.",
  PATCH_MISMATCH: "현재 자료의 패치와 달라 적용할 수 없습니다.",
  TEAM_MISMATCH: "현재 입력의 두 팀이 링크의 두 팀과 달라 적용할 수 없습니다.",
  BAD_VALUE: "링크의 숫자를 입력란 형식으로 옮길 수 없어 적용하지 않습니다.",
};

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => { window.removeEventListener("hashchange", onChange); window.removeEventListener("popstate", onChange); };
}
const currentHref = () => window.location.href;
const serverHref = () => "";

/**
 * "가정값만 공유": copies an assumption-only link of a completed in-page run and previews an incoming
 * `#experiment=` link. Applying is an explicit click that only fills inputs; nothing runs automatically
 * and the address hash is never read-modified here (other hashes such as `#draft=` stay untouched).
 */
export function ExperimentInputLinkPanel({ run, shownMinute, readyInput, blocked, onApply }: Props) {
  const href = useSyncExternalStore(subscribe, currentHref, serverHref);
  const incoming = useMemo(() => {
    if (!href) return null;
    const parsed = parseExperimentInputLink(href);
    return !parsed.ok && parsed.reason === "NO_LINK" ? null : parsed;
  }, [href]);
  const incomingKey = incoming?.ok ? incoming.encoded : incoming ? `invalid:${incoming.reason}` : "";

  const complete = Boolean(run) && shownMinute !== null && Number.isFinite(shownMinute) && shownMinute >= run!.endMinute;
  const [copy, setCopy] = useState<CopyState | null>(null);
  const [copyError, setCopyError] = useState<{ run: ExperimentRun; text: string } | null>(null);
  if (copy && (copy.run !== run || !complete || copy.href !== href)) setCopy(null);
  if (copyError && (copyError.run !== run || !complete)) setCopyError(null);
  /** Bumped on run/completeness/address change and unmount; a clipboard write finishing later is ignored. */
  const copyToken = useRef(0);
  useLayoutEffect(() => {
    copyToken.current += 1;
    return () => { copyToken.current += 1; };
  }, [run, complete, href]);

  const [applied, setApplied] = useState<{ key: string; message: string } | null>(null);
  const shownApplied = applied && applied.key === incomingKey ? applied.message : "";

  async function copyLink() {
    if (!run || !complete || shownMinute === null) return;
    const startHref = window.location.href;
    const created = createExperimentInputLink(startHref, run, shownMinute);
    if (!created.ok) { setCopyError({ run, text: linkRefusalText[created.reason] ?? "가정값 링크를 만들 수 없습니다." }); return; }
    setCopyError(null);
    const token = ++copyToken.current;
    const base = { run, href, url: created.url };
    const writeText = typeof navigator !== "undefined" ? navigator.clipboard?.writeText?.bind(navigator.clipboard) : undefined;
    if (!writeText) { setCopy({ ...base, status: "manual" }); return; }
    setCopy({ ...base, status: "copying" });
    let ok = false;
    try { await writeText(created.url); ok = true; } catch { ok = false; }
    // New run, rewind, unmount or address change meanwhile: drop the late answer.
    if (copyToken.current !== token || window.location.href !== startHref) return;
    setCopy({ ...base, status: ok ? "copied" : "manual" });
  }

  const plan = incoming?.ok ? planExperimentLinkApply(incoming.link, readyInput, blocked) : null;

  function apply() {
    if (!incoming?.ok) return;
    // Re-read the address: a preview of an earlier link is never applied.
    const fresh = parseExperimentInputLink(window.location.href);
    if (!fresh.ok || fresh.encoded !== incoming.encoded) {
      setApplied({ key: incomingKey, message: "주소의 링크가 바뀌어 이전 미리보기는 적용하지 않았습니다." });
      return;
    }
    const next = planExperimentLinkApply(fresh.link, readyInput, blocked);
    if (!next.ok) { setApplied({ key: incomingKey, message: gateText[next.reason] }); return; }
    onApply(next);
    setApplied({ key: incomingKey, message: "두 팀 가정값과 시드 입력란만 바꿨습니다. 결과를 보려면 직접 실행하세요." });
  }

  const order = readyInput ? sourceTeamOrder(readyInput) : null;
  const teamLabel = (id: string, index: number) => {
    if (readyInput && order?.includes(id)) return readyInput.draft.teams.BLUE.id === id ? readyInput.draft.teams.BLUE.name : readyInput.draft.teams.RED.name;
    return `팀 ${index + 1}`;
  };
  const copyNote = !run ? "가정 실험을 실행하고 결과까지 확인하면 가정값 링크를 복사할 수 있습니다."
    : !complete ? "결과까지 확인하면 이 실행의 가정값 링크를 복사할 수 있습니다." : copyError?.text ?? "";
  const incomingNote = !incoming ? "" : !incoming.ok ? (linkRefusalText[incoming.reason] ?? "가정값 링크가 손상되었거나 형식이 맞지 않아 미리보기를 표시하지 않습니다.")
    : plan && !plan.ok ? gateText[plan.reason] : "";

  return <details className="experiment-input-link">
    <summary>가정값만 공유{incoming ? " · 받은 링크 있음" : ""}</summary>
    <p role="note">{EXPERIMENT_LINK_SCOPE} 서명이 없어 누구나 숫자를 고칠 수 있으므로 원본 실험의 증명이 아니며, 전체 실험 재현·근거 공유·실전 승률도 아닙니다.</p>

    <div className="experiment-result-share">
      <button type="button" disabled={!complete || copy?.status === "copying"} onClick={copyLink}
        aria-describedby={copyNote ? "experiment-input-link-copy-note" : undefined}>가정값 링크 복사</button>
      {copyNote && <p id="experiment-input-link-copy-note">{copyNote}</p>}
      <p role="status">{copy?.status === "copying" ? "복사하는 중…" : copy?.status === "copied" ? "실행 당시 고정된 가정값·시드만 담은 링크를 복사했어요."
        : copy?.status === "manual" ? "자동 복사를 할 수 없어요. 아래 주소를 직접 선택해 복사하세요." : ""}</p>
      {copy?.status === "manual" && <textarea readOnly value={copy.url} rows={3}
        aria-label="가정값 링크 (직접 복사)" onFocus={(event) => event.currentTarget.select()} />}
    </div>

    <section className="experiment-input-link-incoming" aria-label="받은 가정값 링크">
      {incoming?.ok ? <>
        <p><b>링크에서 받은 가정값</b> (현재 입력이 아님) · 시드 {incoming.link.seed} · 패치 {readyInput ? (readyInput.patch === incoming.link.patch ? "현재 자료와 같음" : "현재 자료와 다름") : "입력 준비 후 확인"}</p>
        <ul>{incoming.link.teams.map((team, index) => <li key={index}>
          <b>{teamLabel(team.id, index)}</b>{" "}
          {ASSUMPTION_FIELDS.map((field) => `${fieldLabels[field]} ${plainDecimal(team[field]) ?? "?"}`).join(" · ")}
        </li>)}</ul>
      </> : !incoming ? <p>받은 가정값 링크가 없습니다.</p> : null}
      {incomingNote && <p id="experiment-input-link-apply-note" role="status">{incomingNote}</p>}
      <button type="button" disabled={!plan?.ok} onClick={apply}
        aria-describedby={incomingNote ? "experiment-input-link-apply-note" : undefined}>가정값 적용</button>
      <p role="status">{shownApplied}</p>
    </section>
  </details>;
}

export default ExperimentInputLinkPanel;
