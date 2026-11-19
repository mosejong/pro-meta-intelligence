import { MAX_MINUTE, type ExperimentRun } from "./experiment-replay";

export type EventNavigation = {
  previousMinute: number | null;
  nextMinute: number | null;
  endMinute: number | null;
  eventMinutes: number[];
};

/** Same event kinds the replay log shows. GROWTH and END are not navigation stops. */
const SHOWN_KINDS: ReadonlySet<string> = new Set(["SKIRMISH", "OBJECTIVE", "BASE"]);

const REFUSED: EventNavigation = { previousMinute: null, nextMinute: null, endMinute: null, eventMinutes: [] };

/**
 * Display-only navigation over an already computed run. Reads run.result.events; never runs the
 * model, never mutates the run. Cursor normalisation matches replayFrame (floor, clamp 0..end, non-finite → 0).
 */
export function eventNavigation(run: Pick<ExperimentRun, "result" | "endMinute">, minute: number): EventNavigation {
  const end = run?.endMinute;
  if (typeof end !== "number" || !Number.isInteger(end) || end < 0 || end > MAX_MINUTE) return { ...REFUSED, eventMinutes: [] };
  const events = Array.isArray(run.result?.events) ? run.result.events : [];
  const unique = new Set<number>();
  for (const event of events) {
    if (!event || !SHOWN_KINDS.has(event.kind)) continue;
    const at = event.minute;
    if (typeof at === "number" && Number.isInteger(at) && at >= 0 && at <= end) unique.add(at);
  }
  const eventMinutes = [...unique].sort((a, b) => a - b);
  const cursor = typeof minute === "number" && Number.isFinite(minute) ? Math.max(0, Math.min(end, Math.floor(minute))) : 0;
  let previousMinute: number | null = null;
  let nextMinute: number | null = null;
  for (const at of eventMinutes) {
    if (at < cursor) previousMinute = at;
    else if (at > cursor) { nextMinute = at; break; }
  }
  return { previousMinute, nextMinute, endMinute: end, eventMinutes };
}
