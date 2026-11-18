import { isAIValidationStatus, type AIValidationStatus } from "./ai-validation";
import { collectionStatusMessage, isCollectionStatus, type CollectionStatus } from "./collection-status";
import { isCreatorBrief, type CreatorBrief } from "./creator-storyboard";
import { isDecisionOutcomesFeed, type DecisionOutcomesFeed } from "./decision-outcomes";
import { PUBLICATION_FRESHNESS_POLICY, snapshotFreshness } from "./freshness";
import {
  isHistoryStatus,
  isRadarReport,
  isScheduleChangeLog,
  isScheduleSnapshot,
  type HistoryStatus,
  type RadarReport,
  type ScheduleChangeLog,
  type ScheduleSnapshot,
} from "./radar-types";

/** Bounded waits for the published feed. Both limits cover the response headers AND the body read. */
export const CORE_TIMEOUT_MS = 15_000;
export const COMPANION_TIMEOUT_MS = 10_000;

export type FeedState = {
  kind: "connecting" | "published" | "demo" | "uploaded";
  label: string;
  detail: string;
};

export type FetchLike = (input: URL | string, init?: RequestInit) => Promise<Response>;

export type LoadContext = {
  base: URL;
  signal: AbortSignal;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
};

export class PublicationTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`${url} did not finish within ${timeoutMs}ms`);
    this.name = "PublicationTimeoutError";
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The publication request was aborted.", "AbortError");
}

/**
 * Fetches and parses one JSON document. The timer and the caller's abort signal race both the
 * response and `response.json()`, so a stalled body cannot hold the loader open. Every timer and
 * listener is released before returning.
 */
export async function fetchJsonWithTimeout(url: URL | string, { signal, fetchImpl = fetch, timeoutMs = COMPANION_TIMEOUT_MS }: Omit<LoadContext, "base">): Promise<unknown> {
  if (signal.aborted) throw abortReason(signal);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new PublicationTimeoutError(String(url), timeoutMs);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
    onAbort = () => {
      const reason = abortReason(signal);
      controller.abort(reason);
      reject(reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  interrupted.catch(() => undefined);
  try {
    const response = await Promise.race([fetchImpl(url, { cache: "no-store", signal: controller.signal }), interrupted]);
    if (!response.ok) throw new Error(`${String(url)} returned ${response.status}`);
    return await Promise.race([response.json() as Promise<unknown>, interrupted]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
    // Releases an unread or stalled body; a no-op once the body has been consumed.
    controller.abort();
  }
}

function feedUrl(base: URL, file: string) {
  return new URL(`feed/${file}`, base);
}

function readFeed(context: LoadContext, file: string, timeoutMs = context.timeoutMs ?? COMPANION_TIMEOUT_MS) {
  return fetchJsonWithTimeout(feedUrl(context.base, file), { signal: context.signal, fetchImpl: context.fetchImpl, timeoutMs });
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw abortReason(signal);
}

export async function loadCoreReport(context: LoadContext): Promise<RadarReport> {
  const payload = await readFeed(context, "current.json", context.timeoutMs ?? CORE_TIMEOUT_MS);
  if (!isRadarReport(payload)) throw new Error("unsupported report");
  return payload;
}

export async function loadCollectionStatus(context: LoadContext): Promise<CollectionStatus> {
  const payload = await readFeed(context, "collection-status.json");
  if (!isCollectionStatus(payload)) throw new Error("unsupported collection status");
  return payload;
}

export async function loadCreatorBrief(context: LoadContext, core: RadarReport): Promise<CreatorBrief> {
  const payload = await readFeed(context, "current-creator.json");
  if (
    !isCreatorBrief(payload) ||
    payload.source_snapshot.patch_id !== core.patch_id ||
    payload.source_snapshot.cutoff !== core.cutoff
  ) throw new Error("creator feed does not match radar feed");
  return payload;
}

export async function loadAIValidation(context: LoadContext): Promise<AIValidationStatus> {
  const payload = await readFeed(context, "ai-validation.json");
  if (!isAIValidationStatus(payload)) throw new Error("unsupported AI validation status");
  return payload;
}

export type HistoryOutcomes = { historyStatus: HistoryStatus | null; outcomes: DecisionOutcomesFeed | null };

/**
 * Reads history-status and decision-outcomes in parallel, then keeps the previous dependency rule:
 * outcomes are accepted only when their as_of/benchmark_ready match the effective history status
 * (the separately published one, else the one embedded in the core report).
 */
export async function loadHistoryAndOutcomes(context: LoadContext, core: RadarReport): Promise<HistoryOutcomes> {
  const [history, outcomes] = await Promise.allSettled([
    readFeed(context, "history-status.json"),
    readFeed(context, "decision-outcomes.json"),
  ]);
  throwIfAborted(context.signal);
  const historyStatus = history.status === "fulfilled" && isHistoryStatus(history.value) ? history.value : null;
  const effectiveHistory = historyStatus ?? core.history_status ?? null;
  const outcomesPayload = outcomes.status === "fulfilled" ? outcomes.value : null;
  const acceptedOutcomes = isDecisionOutcomesFeed(outcomesPayload) &&
    effectiveHistory !== null &&
    outcomesPayload.as_of === effectiveHistory.as_of &&
    outcomesPayload.benchmark_ready === effectiveHistory.benchmark_ready
    ? outcomesPayload
    : null;
  return { historyStatus, outcomes: acceptedOutcomes };
}

export type ScheduleResult = {
  schedule: ScheduleSnapshot;
  changes: ScheduleChangeLog | null;
  state: "connected" | "stale";
};

/** Schedule and its change log are fetched together; the log is kept only if it names this exact snapshot. */
export async function loadScheduleAndChanges(context: LoadContext, checkedAt: string): Promise<ScheduleResult> {
  const [schedule, changes] = await Promise.allSettled([
    readFeed(context, "schedule.json"),
    readFeed(context, "schedule-changes.json"),
  ]);
  throwIfAborted(context.signal);
  if (schedule.status === "rejected") throw schedule.reason;
  const snapshot = schedule.value;
  if (!isScheduleSnapshot(snapshot)) throw new Error("unsupported schedule");
  const changeLog = changes.status === "fulfilled" ? changes.value : null;
  const matchingChanges = isScheduleChangeLog(changeLog) &&
    changeLog.current_snapshot.content_hash === snapshot.content_hash &&
    changeLog.current_snapshot.retrieved_at === snapshot.retrieved_at
    ? changeLog
    : null;
  const ageHours = (Date.parse(checkedAt) - Date.parse(snapshot.retrieved_at)) / (60 * 60 * 1000);
  return { schedule: snapshot, changes: matchingChanges, state: ageHours <= 36 ? "connected" : "stale" };
}

/** Returns a new report; the fetched core object is never mutated. */
export function withHistoryStatus(core: RadarReport, historyStatus: HistoryStatus | null): RadarReport {
  return historyStatus ? { ...core, history_status: historyStatus } : core;
}

/**
 * Feed label for a verified core report. While companions are still loading the detail says so,
 * and a stale publication never claims a collection state that has not been read yet.
 */
export function describePublishedFeed(
  report: RadarReport,
  checkedAt: string,
  collection: CollectionStatus | null,
  companionsPending: boolean,
): FeedState {
  if (report.fixture_only) return { kind: "demo", label: "PUBLISHED DEMO FEED", detail: "자동 연결됨 · 합성 데이터" };
  const freshness = snapshotFreshness(report.cutoff, checkedAt, PUBLICATION_FRESHNESS_POLICY);
  if (freshness.level === "STALE") {
    const collectionDetail = companionsPending && !collection
      ? "수집 상태 확인 중"
      : collectionStatusMessage(collection, checkedAt) ?? "현재 판단 잠금";
    return { kind: "published", label: "STALE · REVIEW ONLY", detail: `자동 연결됨 · ${freshness.ageLabel} 발행본 · ${collectionDetail}` };
  }
  return {
    kind: "published",
    label: "LIVE PUBLISHED FEED",
    detail: companionsPending ? "자동 연결됨 · 검증된 발행본 · 부가 자료 확인 중" : "자동 연결됨 · 검증된 발행본",
  };
}

/** A failed refresh keeps the already connected publication, without relabelling it as live or new. */
export function describeRefreshFailure(previous: FeedState): FeedState {
  return {
    kind: previous.kind,
    label: previous.kind === "uploaded"
      ? "REFRESH FAILED · LOCAL FILE KEPT"
      : previous.kind === "demo" ? "REFRESH FAILED · PREVIOUS DEMO FEED" : "REFRESH FAILED · PREVIOUS FEED",
    detail: previous.kind === "uploaded"
      ? "새로고침 실패 · 불러온 파일 유지"
      : "새로고침 실패 · 이전 발행본 유지 · 확인 시각은 마지막 성공 기준",
  };
}

export const FIRST_LOAD_FAILURE: FeedState = {
  kind: "demo",
  label: "DEMO FALLBACK",
  detail: "발행 피드 없음 · 내장 데모 표시 중",
};
