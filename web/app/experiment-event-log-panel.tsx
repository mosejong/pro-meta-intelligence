"use client";

import { useId, useState } from "react";
import type { ManagerEvent } from "./simulation-core";
import "./experiment-event-log-panel.css";

/** Number of most recent events shown while the log is folded (the replay's original view). */
export const RECENT_EVENT_COUNT = 8;

/** Event kinds the replay log has always shown; GROWTH/END never reach replayFrame().log. */
const SHOWN_KINDS: ReadonlySet<string> = new Set(["SKIRMISH", "OBJECTIVE", "BASE"]);

export type EventLogEntry = { key: string; minute: number; text: string };

/** Same wording as the replay log has used: model events only, never real game facts. */
export function eventLogText(event: ManagerEvent, actorName: string): string {
  return event.kind === "SKIRMISH" ? `${actorName} 교전 우세 (모델 킬 +${event.amount})`
    : event.kind === "OBJECTIVE" ? `${actorName} 추상 오브젝트 +1`
    : `${actorName} 상대 기지 피해 ${event.amount}`;
}

/**
 * Display rows of an already filtered replay log (replayFrame(run, minute).log holds only events up to
 * the shown minute, so later events and the winner can never appear here). Folded → the last
 * RECENT_EVENT_COUNT in order; expanded → every shown event. Keys use the absolute log index so rows keep
 * their identity when the view expands. Pure: the log is never mutated or re-ordered.
 */
export function eventLogEntries(log: readonly ManagerEvent[], expanded: boolean, nameOf: (actor: string) => string): EventLogEntry[] {
  const rows = (Array.isArray(log) ? log : [])
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event && SHOWN_KINDS.has(event.kind));
  const visible = expanded ? rows : rows.slice(-RECENT_EVENT_COUNT);
  return visible.map(({ event, index }) => ({ key: `${index}-${event.minute}-${event.kind}`, minute: event.minute, text: eventLogText(event, nameOf(event.actor)) }));
}

type ExperimentEventLogPanelProps = {
  /** Frozen run this log belongs to; a new run always starts folded. */
  runId: number;
  /** replayFrame(run, shownMinute).log: events up to the shown minute only. */
  log: readonly ManagerEvent[];
  /** Display name of a core team id ("team_a" / "team_b"). */
  nameOf: (actor: string) => string;
};

/**
 * Model event log of the replay. Shows the latest 8 events and, when more exist, an explicit toggle to
 * read every event up to the current shown minute. Display only: it never seeks, runs or changes the run.
 */
export function ExperimentEventLogPanel({ runId, log, nameOf }: ExperimentEventLogPanelProps) {
  // Remember which run was expanded instead of a boolean, so a new run never inherits an open log.
  const [expandedRunId, setExpandedRunId] = useState<number | null>(null);
  const listId = `${useId()}-event-log`;
  const total = eventLogEntries(log, true, nameOf).length;
  const foldable = total > RECENT_EVENT_COUNT;
  const expanded = foldable && expandedRunId === runId;
  const entries = eventLogEntries(log, expanded, nameOf);

  return <div className="experiment-event-log" data-expanded={expanded || undefined}>
    {foldable && <div className="experiment-event-log-head">
      <p>{expanded ? `현재 시각까지의 모델 사건 전체 ${total}건` : `현재 시각까지 ${total}건 중 최근 ${RECENT_EVENT_COUNT}건`}</p>
      <button type="button" aria-expanded={expanded} aria-controls={listId}
        onClick={() => setExpandedRunId(expanded ? null : runId)}>{expanded ? "최근 8건만 보기" : `전체 ${total}건 펼치기`}</button>
    </div>}
    <ol id={listId} className="experiment-replay-log" aria-label="지금까지의 모델 사건">{entries.length ? entries.map((entry) =>
        <li key={entry.key}><span>{entry.minute}분</span>{entry.text}</li>)
      : <li>아직 교전·오브젝트 사건이 없습니다.</li>}</ol>
  </div>;
}

export default ExperimentEventLogPanel;
