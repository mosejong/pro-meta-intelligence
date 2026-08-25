# T1 Match-Day Brief

## Purpose

The T1 Match-Day Brief combines the normalized official LoL Esports schedule snapshot with the
existing T1 Target Profile. It answers three separate questions without collapsing them into one
score:

1. Is there a future official fixture containing the exact T1 identity?
2. Is the other participant confirmed, and is the selected own team actually in that fixture?
3. Which public T1 draft observations can staff review before the participant is confirmed?

The dashboard generates the deterministic `target-match-day-brief` artifact in the browser. It
contains the fixture state, readiness checks, preparation questions, evidence IDs, and source
hashes and can be downloaded as JSON.

## Fixture relationship states

- `CONFIRMED_HEAD_TO_HEAD`: the selected own team and T1 both appear in the same official event.
- `TARGET_AS_OWN_TEAM`: T1 is selected as the own team and the next opponent is confirmed.
- `TARGET_FIXTURE_OTHER_OPPONENT`: the event is a T1 fixture, but not a direct match against the
  selected own team.
- `PARTICIPANT_TBD`: T1 is confirmed but the other official participant is still TBD.
- `PERSPECTIVE_UNSET`: the fixture is known but no own-team perspective is selected.
- `NO_UPCOMING_FIXTURE`: a valid schedule snapshot contains no future T1 event.
- `SCHEDULE_UNAVAILABLE`: no current validated schedule snapshot is available to the builder.

The relationship is recomputed whenever the five-minute schedule refresh succeeds. A TBD bracket
slot is never resolved from standings, community posts, or name heuristics.

## Readiness gates

The UI presents these checks independently:

- official fixture availability,
- opponent identity,
- minimum T1 public-draft sample,
- latest observed five-player profile,
- historical series-link availability.

A missing historical series ID does not hide the official future fixture. Conversely, the official
fixture event ID is not retroactively treated as an Oracle's Elixir historical series ID.

## Current published state

At the 2026-08-25 schedule retrieval, the normalized official source contains a T1 LCK Playoffs
Bo5 at 2026-08-29 08:00 UTC. The other participant is still `TBD`, so the brief correctly reports
`WAITING_FOR_OPPONENT` while retaining evidence-bounded preparation tasks from the current T1
profile.

## Boundaries

- Official schedule facts can change at the source.
- The brief does not infer bracket resolution or claim a direct own-team matchup without both
  participants in the same official event.
- Public picks, bans, players, and patch shifts do not expose scrims, player readiness, or private
  draft intent.
- Schedule event IDs and historical game/series IDs remain separate namespaces.
