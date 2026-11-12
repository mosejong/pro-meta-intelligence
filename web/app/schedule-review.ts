import type { ScheduleSnapshot } from "./radar-types";

// Human-reviewed corrections to the official schedule feed. An entry only withholds an event whose
// ID, start time and participants all match, so a corrected feed is never filtered by accident.
// Results are never inferred: each entry cites the published match reports it was checked against.
export const WITHHELD_SCHEDULE_EVENTS = [
  {
    event_id: "lolesports:67ea4f7ace5a2a294acb",
    start_at: "2026-11-14T19:00:00+00:00",
    participants: ["BLG", "T1"],
    checked_on: "2026-11-11",
    reason: "T1은 11.08 4강에서 BLG에 1:3으로 져 탈락했습니다. 11.14 결승은 GEN vs BLG입니다. 피드에 남은 'Semifinals T1 vs BLG' 11.14 일정은 표시하지 않습니다.",
    sources: [
      "https://dotesports.com/league-of-legends/news/worlds-2026-semifinals-day-2-results",
      "https://www.fragster.com/blg-t1-worlds-2026-semifinal/",
      "https://en.wikipedia.org/wiki/2026_League_of_Legends_World_Championship_final",
    ],
  },
] as const;

export type WithheldScheduleEvent = (typeof WITHHELD_SCHEDULE_EVENTS)[number];

const sameParticipants = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && [...left].sort().every((code, index) => code === [...right].sort()[index]);

export function applyScheduleReview(schedule: ScheduleSnapshot | null, reviews: readonly WithheldScheduleEvent[] = WITHHELD_SCHEDULE_EVENTS) {
  if (!schedule) return { schedule, withheld: [] as WithheldScheduleEvent[] };
  const withheld: WithheldScheduleEvent[] = [];
  const events = schedule.events.filter((event) => {
    const review = reviews.find((item) => item.event_id === event.event_id &&
      Date.parse(item.start_at) === Date.parse(event.start_at) &&
      sameParticipants(item.participants, event.participants.map((participant) => participant.code)));
    if (review) withheld.push(review);
    return !review;
  });
  return { schedule: withheld.length ? { ...schedule, events } : schedule, withheld };
}
