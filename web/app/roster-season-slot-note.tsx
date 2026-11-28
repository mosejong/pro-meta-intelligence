"use client";
import { SEASON_SLOT_BOUNDARY, seasonSlotLabel, type SeasonSlotIdentity } from "./roster-season-slots";

/**
 * Shared label for a slot holding a past-season player: its identity plus the short boundary that the
 * current publication's evidence is not computed for it. Used by the roster slot, the snapshot
 * evidence panel and the annual record so all three say the same thing.
 */
export function SeasonSlotNote({ identity, boundary = SEASON_SLOT_BOUNDARY }: { identity: SeasonSlotIdentity; boundary?: string }) {
  return <span className="roster-season-slot" data-season-slot={identity.status} data-season-card={identity.status === "SEASON" ? identity.card_id : undefined}>
    <b>{seasonSlotLabel(identity)}</b>
    {identity.status === "SEASON" && <> · 당시 표본 {identity.game_count}경기</>}
    {" · "}<small>{boundary}</small>
  </span>;
}
