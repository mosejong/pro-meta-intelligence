# T1 Target Profile

## Purpose

T1 Target Profile is the T1-specific preparation layer above Opponent Prep Pack. It adds only fields
supported by public professional-match rows:

- the five players observed in T1's latest available game,
- each observed player's same-patch champion pool and evidence IDs,
- up to five recent games with opponent, side, first-pick state, result, players, and champions,
- champion-role game-rate changes against the previous available patch,
- an own-team-versus-T1 summary from the existing Draft Battlecard.

The detailed profile is generated only for exact allowlisted team identities. The default allowlist
contains `T1`; `T1 Esports Academy` and partial-name matches do not qualify. Every team receives a
bounded latest-match player/role profile for confirmed-opponent lane pairing, but recent-game
timelines, previous-patch deltas, and series diagnostics remain target-only. This avoids duplicating
the heavier timelines for every team in the public feed.

## Roster boundary

Oracle's Elixir exposes public player name and ID fields on player rows. The importer carries those
fields onto pick events. A team ID can still contain more than one observed lineup in a patch. The
profile therefore marks players from the latest available T1 match as `CURRENT` and keeps other
same-patch players as `OTHER_OBSERVED`. The UI shows the latest five and reports the other-lineup
count instead of presenting ten players as one roster.

`CURRENT` means only **latest publicly observed lineup in this snapshot**. It is not a contract,
transfer, eligibility, health, or match-day starting-roster claim.

## Series boundary

The reviewed 2026 OE CSV has no stable provider series identifier. Match records deliberately carry
a `series-unavailable` placeholder, and the T1 profile shows a recent-game timeline. It does not
group games into series by opponent, calendar date, or game number because that would be an
unverified heuristic.

## Patch comparison

For the previous numerically available patch, the system compares:

```text
current champion-role game rate - previous champion-role game rate
```

The three largest positive and negative deltas are displayed with both patches' event evidence.
This is a descriptive signal, not a prediction that a pick will repeat.

## Export and unknowns

The dashboard exports a deterministic `team-target-profile` JSON artifact. It includes match IDs,
draft-event IDs, source versions, own-team matchup counts, and these explicit unknowns:

- current player condition and scrim familiarity,
- T1's private draft plan or coaching intent,
- a true series grouping when the provider does not supply one.
