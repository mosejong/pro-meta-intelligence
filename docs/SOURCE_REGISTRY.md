# Source Registry and Data Dragon Adapter

## Purpose

External collection is fail-closed. A user interest, AI request, or future agent cannot turn an
arbitrary URL into a crawl job. Every source and operation must be present in a reviewed registry
entry before network access occurs.

This increment implements the policy and archival boundary plus one narrow real adapter. It is not a
general crawler.

## Current official-policy review

Reviewed on 2026-08-22:

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

The registry review expires after 30 days. Once expired, the adapter refuses network access until the
checked-in review timestamp and policy notes are deliberately updated. Internal status `ENABLED`
means only that this repository permits the listed operation; it is not Riot approval of the product.

## Registered sources

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

Unregistered sources and operations are denied automatically.

## Raw and normalized time semantics

A Data Dragon response first becomes a `RawSourceArtifact` containing:

- requested and final URL,
- retrieval timestamp,
- media type,
- exact response bytes,
- SHA-256 content hash.

`SnapshotArchive` stores response bytes under the content hash and a separate immutable metadata file
for each retrieval timestamp. Re-fetching unchanged content reuses the raw bytes without losing the
new retrieval event.

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

## CLI

Inspect policy state:

```bash
python -m pro_meta_intelligence sources
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

## Deferred intentionally

- Riot match, ranked, or tournament API calls
- API credential storage
- arbitrary user-provided URLs
- HTML crawling or robots parsing
- login/session automation
- social, video, forum, or expert-source adapters
- automatic patch-note interpretation
- automatic publication or Creator Mode generation

Each future adapter needs its own registry entry, collection contract, offline fixtures, policy review,
rate-limit behavior, provenance, and tests before enablement.
