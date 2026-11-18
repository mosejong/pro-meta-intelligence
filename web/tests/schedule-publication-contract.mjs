import assert from "node:assert/strict";

/** Build/copy integrity, not a second HTML parser or a claim of source freshness. */
export function assertSchedulePublication(schedule, source, isScheduleSnapshot) {
  assert.ok(isScheduleSnapshot(schedule), "supported schedule snapshot required");
  assert.deepEqual(schedule, source, "built schedule must equal the accepted source artifact");
  assert.equal(schedule.source_id, "lol-esports-schedule");
  assert.equal(new URL(schedule.source_url).hostname, "lolesports.com");
  assert.match(schedule.content_hash, /^sha256:[0-9a-f]{64}$/);
  assert.ok(Number.isFinite(Date.parse(schedule.retrieved_at)));
  assert.equal(schedule.quality.event_count, schedule.events.length);
  assert.equal(new Set(schedule.events.map(event => event.event_id)).size, schedule.events.length);
  assert.equal(schedule.quality.tbd_participant_count,
    schedule.events.flatMap(event => event.participants).filter(player => player.name.toUpperCase() === "TBD").length);
}
