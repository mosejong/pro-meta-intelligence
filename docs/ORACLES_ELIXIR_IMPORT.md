# Oracle's Elixir Local CSV Import

## Scope and policy decision

Reviewed on 2026-08-22, the official Oracle's Elixir download page exposed annual League of Legends
CSV files through a public Google Drive folder. The page states that files are free for analysts,
commentators, and fans, update once daily, and have no value in being downloaded more frequently.
The 2026 file was visible as a 59.8 MB CSV. Its live header matched the fields used by this adapter,
including `gameid`, `datacompleteness`, `league`, `date`, `patch`, `participantid`, `side`,
`position`, `teamid`, `firstPick`, `champion`, and `pick1` through `pick5`.

`FETCH_PUBLISHED_CSV` is now enabled for the exact 2026 file ID verified in that official folder.
The downloader does not enumerate Drive or accept caller-supplied URLs. It enforces the provider's
daily interval using local archive metadata, rejects quota/error HTML and schema drift, stores the
original CSV by content hash, and never republishes the raw file. `IMPORT_LOCAL_CSV` remains
available for a file obtained manually from the same provider page.

For unattended operation, `sync-oe-feed` holds the single-writer lock across acquisition,
normalization, Radar/Creator generation, and publication. A provider error can reuse a previously
verified archive with an explicit status. With no verified cache, publication fails closed and the
existing feed is not moved.

After normalization, unattended sync also runs the explicit annual coverage gate documented in
[`OE_COVERAGE_AUDIT.md`](OE_COVERAGE_AUDIT.md). Import defects or insufficient latest-patch breadth
are retained in the job audit and do not advance the public feed.

References:

- [Official downloads](https://master.d36liwrx5rvjnc.amplifyapp.com/tools/downloads)
- [Match data dictionary](https://lol.timsevenhuysen.com/matchdata/match-data-dictionary/)
- [Riot general policies](https://developer.riotgames.com/policies/general)

## Data contract

One valid game must contain exactly 12 contiguous records:

- players `1-5` on Blue,
- players `6-10` on Red,
- team aggregate `100` on Blue,
- team aggregate `200` on Red.

The source dictionary warns that `gameid` may not be globally unique. Normalized match IDs therefore
combine the provider, league, and game ID: `oe:{league}:{gameid}`.

The source does not expose a stable series identifier in the reviewed schema. `series_id` is a
clearly named game-scoped placeholder rather than a fabricated series grouping. Series reconstruction
is deferred until a separately validated contract exists.

The importer emits ten pick events. It converts each team's `pick1-pick5` order into standard global
pick slots using `firstPick`, then joins champions back to player rows for roles. It does not emit
bans because banned champions have no reliable role in this source.

## Point-in-time behavior

The annual CSV is mutable and updated daily. SHA-256 identifies the exact bytes imported. The local
snapshot retrieval timestamp becomes both provenance `retrieved_at` and record `available_at`.
Consequently, a current annual file is useful for current radar construction but cannot serve as if
it had been available at an earlier historical cutoff.

The source date has no timezone suffix. The importer requires the caller to choose a timezone and
records that choice in the report. `UTC` and explicit offsets such as `+09:00` work without an
external timezone database.

## QA and rejection policy

Schema-level drift, such as a missing required column or non-contiguous duplicate game group, fails
the entire import. Game-level defects reject only that game and produce issue codes, including:

- `INVALID_ROW_COUNT`
- `INVALID_PARTICIPANTS`
- `INCOMPLETE_GAME`
- `INCONSISTENT_GAME_FIELD`
- `INVALID_TEAM_SIDES`
- `INVALID_WINNER`
- `INVALID_ROLE_SET`
- `PLAYER_TEAM_MISMATCH`
- `INVALID_FIRST_PICK`
- `PICK_SET_MISMATCH`
- `OBSERVED_AFTER_RETRIEVAL`

The CLI can return exit code 2 on any reported import issue with `--fail-on-rejected`. It reports counts,
hash, byte size, observed range, leagues, patches, and bounded issue details. Local absolute paths are
never written into provenance by default.

## Known limitations

- A local manual import remains `UNVERIFIED_CALLER_SUPPLIED_FILE`; an adapter download records the
  exact reviewed official file ID and retrieval URL.
- Google Drive can temporarily return a quota page. This is reported as source unavailable and is
  never archived or interpreted as CSV.
- Full annual-file performance has not yet been benchmarked in CI; fixtures preserve the real 2026
  structural contract without committing provider data.
- The official timezone semantics still require provider confirmation.
- Current files cannot reconstruct historical availability before the recorded retrieval time.
- Ban-role analytics and series reconstruction remain deferred.
