# Source Registry and Reviewed Data Adapters

## Purpose

External collection is fail-closed. A user interest, AI request, or future agent cannot turn an
arbitrary URL into a crawl job. Every source and operation must be present in a reviewed registry
entry before network access occurs.

The implementation provides a policy boundary plus narrowly scoped adapters. It is not a general
crawler.

## Current official-policy review

Reviewed on 2026-08-24:

- Riot's [League of Legends developer documentation](https://developer.riotgames.com/docs/lol)
  documents the Data Dragon version index and versioned champion static-data files.
- Riot's [Developer Portal documentation](https://developer.riotgames.com/docs/portal) distinguishes
  development, personal, and production API keys and states that public products require an
  appropriate production key.
- Riot's [General Policies](https://developer.riotgames.com/policies/general) require developers to
  follow policy changes, protect credentials, and avoid de-anonymizing players who cannot reasonably
  be identified from visible information.
- Riot's [API Terms](https://developer.riotgames.com/terms) remain applicable to use of Riot developer
  materials.
- Riot's published developer API list does not document a professional esports schedule endpoint.
  The official [LoL Esports schedule](https://lolesports.com/en-US/leagues/lck) instead exposes
  upcoming match cards in server-rendered semantic HTML, and its current
  [robots.txt](https://lolesports.com/robots.txt) contains no disallow rule.
- Oracle's Elixir's
  [official download page](https://master.d36liwrx5rvjnc.amplifyapp.com/tools/downloads) states that
  its CSV files are provided free for analysts, commentators, and fans, are updated once per day,
  and should not be downloaded more frequently.
- The [Oracle's Elixir data dictionary](https://lol.timsevenhuysen.com/matchdata/match-data-dictionary/)
  warns that schemas may change and that game IDs may not be globally unique across leagues.

The registry review expires after 30 days. Once expired, the adapter refuses network access until the
checked-in review timestamp and policy notes are deliberately updated. Internal status `ENABLED`
means only that this repository permits the listed operation; it is not Riot approval of the product.

## Registered sources

### `oracles-elixir-match-data`

Enabled for `FETCH_PUBLISHED_CSV` and `IMPORT_LOCAL_CSV`. The download adapter accepts only an exact
file ID checked into `oe_published_files.json` after it has been verified in the official public
Google Drive folder. It does not enumerate the folder, accept arbitrary URLs, or crawl HTML. The
reviewed registry interval is one day because the provider says files update once daily.

The downloader enforces that interval across processes using the latest archived retrieval
metadata. It rejects HTML quota/error pages, validates the CSV header before archival, limits the
response to 200 MiB, and stores the original bytes under a SHA-256 filename. There is deliberately
no force flag for bypassing the provider interval.

The importer hashes the complete file, treats the hash as the mutable annual file's version, checks
the 2026 column contract, and validates every game as one contiguous group containing participant
IDs `1-10`, `100`, and `200`. A game is normalized only when all of the following agree:

- 12 rows and `datacompleteness=complete`,
- one Blue and one Red team row with exactly one winner and first-pick side,
- five unique player positions and stable team IDs per side,
- `pick1` through `pick5` matching the five player champions,
- available `ban1` through `ban5` values retained with unresolved role,
- a game timestamp that does not occur after retrieval.

Invalid games are rejected as a unit and included in a machine-readable QA report. Picks are mapped
to global pick order and player roles. Bans are mapped to a separate global ban order with
`role=UNKNOWN`; missing individual ban values remain explicit Opponent Prep quality warnings.

### `riot-data-dragon`

Enabled only for:

- `FETCH_VERSION_INDEX`
- `FETCH_CHAMPION_CATALOG`

The adapter constructs paths from validated version and locale tokens, uses HTTPS, allows only the
registered Data Dragon host, identifies itself with a project user agent, limits response size, and
applies a conservative one-second minimum interval.

The live version index also contains legacy labels such as `lolpatch_7.20`. This adapter deliberately
selects only modern numeric `N.N.N` versions for versioned CDN paths and preserves the complete raw
index in the archive.

### `riot-web-api`

Present but `REVIEW_REQUIRED`, with no allowed operations. It remains blocked until endpoint scope,
key class, rate limits, retention rules, and public product registration are configured. No API key
is read or stored by the current implementation.

### `lol-esports-schedule`

Enabled only for `FETCH_SCHEDULE_HTML`. Riot does not currently list a professional schedule API in
its public developer API catalog, so this adapter requests only the official LoL Esports league
schedule route. It constructs that route from a validated locale and a maximum of 12 league slugs;
it cannot accept an arbitrary URL, navigate links, log in, or call an undocumented JSON endpoint.

The adapter identifies itself with the project user agent, permits no more than one request every
six hours across archived runs, limits the response to 5 MiB, requires HTML, and extracts only
semantic future match facts: start time, teams, league, stage block, and best-of count. The exact
response is archived before a normalized companion feed is written. A source error or interval
denial preserves the last good published schedule rather than replacing it with an empty file.

The dashboard treats a schedule snapshot older than 36 hours as stale and excludes it from opponent
scoring. This conservative UI limit is intentionally shorter than the source-policy review window:
policy validity does not imply that an individual snapshot is operationally fresh.

Unregistered sources and operations are denied automatically.

## Raw and normalized time semantics

A Data Dragon response first becomes a `RawSourceArtifact` containing:

- requested and final URL,
- retrieval timestamp,
- media type,
- exact response bytes,
- SHA-256 content hash.

`SnapshotArchive` stores response bytes under the content hash (`.json`, `.csv`, or `.html`) and a separate
immutable metadata file for each retrieval timestamp. Re-fetching unchanged content reuses the raw
bytes without losing the new retrieval event. Operational archive lookup verifies metadata schema,
safe file references, byte length, and SHA-256 before returning a snapshot; corruption fails closed.
Completed bytes are atomically linked into write-once final names rather than exposed while writing.

Data Dragon's champion catalog does not itself prove the patch release timestamp. Therefore raw
fetching does not fabricate `observed_at`. Normalization into `ChampionCatalogSnapshot` requires a
separately verified `release_at` value:

```text
observed_at  = externally verified patch release time
available_at = actual retrieval time (conservative policy)
retrieved_at = actual retrieval time
```

Using retrieval time as `available_at` may understate historical lead time, but it cannot leak a
record into a period before this collector actually possessed it. A future archival availability
policy may use earlier timestamps only after it is documented and tested.

Oracle's Elixir's `date` column is timezone-naive in the reviewed CSV and the public dictionary does
not state a timezone. Therefore the caller must provide `UTC`, a fixed offset such as `+09:00`, or an
installed IANA zone. The importer does not guess. For every imported record:

```text
observed_at  = source date interpreted with the caller's explicit timezone
available_at = explicit local snapshot retrieval time
retrieved_at = explicit local snapshot retrieval time
```

A file downloaded today cannot be injected into a historical cutoff before today merely because it
contains older games. Reconstructing earlier availability requires archived snapshots captured at
those earlier times.

## CLI

Inspect policy state:

```bash
python -m pro_meta_intelligence sources
python -m pro_meta_intelligence fetch-oe --year 2026
python -m pro_meta_intelligence sync-oe-feed --year 2026 --source-timezone UTC
python -m pro_meta_intelligence audit-oe-history \
  --archive-dir outputs/oracles-elixir/raw \
  --source-timezone UTC
python -m pro_meta_intelligence fetch-schedule \
  --league lck --league lec --league lpl --league lcs --league msi --league worlds
```

Fetch the current version index and champion catalog, then store both raw artifacts:

```bash
python -m pro_meta_intelligence fetch-ddragon \
  --version latest \
  --locale en_US \
  --archive-dir outputs/ddragon
```

Normalize only when a release timestamp has been verified independently:

```bash
python -m pro_meta_intelligence fetch-ddragon \
  --version 16.15.1 \
  --locale en_US \
  --release-at 2026-08-12T00:00:00Z
```

The example timestamp is illustrative, not a claim about the real release time of that version.

Validate and normalize a locally downloaded Oracle's Elixir CSV:

```bash
python -m pro_meta_intelligence import-oe \
  --input outputs/oracles-elixir/2026_LoL_esports_match_data_from_OraclesElixir.csv \
  --source-timezone UTC \
  --retrieved-at 2026-08-22T03:00:00Z \
  --output outputs/oracles-elixir/2026-import-report.json
```

The command marks authenticity as `UNVERIFIED_CALLER_SUPPLIED_FILE`: matching a schema and hash does
not prove that an arbitrary local file came from the provider. Use `--fail-on-rejected` in scheduled
quality gates.

## Deferred intentionally

- Riot match, ranked, or tournament API calls
- API credential storage
- arbitrary user-provided URLs
- arbitrary or recursive HTML crawling and automated link discovery
- login/session automation
- social, video, forum, or expert-source adapters
- automatic patch-note interpretation
- AI-authored or unreviewed Creator Mode publication

Each future adapter needs its own registry entry, collection contract, offline fixtures, policy review,
rate-limit behavior, provenance, and tests before enablement.
