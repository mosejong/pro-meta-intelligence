# Consolidated release backlog - 2026-09-21

This ledger consolidates ROADMAP phases 0-9, open GitHub issues #2/#58, draft validation,
Worlds preparation and the submission package. Completed product behavior is distinct from
unmet research gates. No new LCK fixtures are a prerequisite.

## Completed in this release

| Priority | Work | Result / evidence |
| --- | --- | --- |
| P0 | Renew expired source review | September 21 official OE download guidance, dictionary and Riot static-data policies rechecked. OE/Data Dragon keep the same allowed operations, hosts and rate limits; only review timestamps renewed. Schedule review remains due September 23. |
| P1 | Refresh confirmed Worlds participants | September 21 official English overview names 13 teams. Add DK/TES/AL/G2/KC/MKOI with exact first-team matches; separate qualification and rules review dates. |
| P1 | Restore national review journals | Bounded JSON import merges duplicate records, retains completed verdicts, and rejects conflicts atomically before storage writes. Changed-tab storage guard; existing exports remain compatible and unverified. |
| P0 | Preserve LCK preparation after season end | Hosted selection follows the latest available exact LCK patch, with explicit selection provenance and unchanged readiness gates. Reviewed HC/LAS/LJL/VCS regions; academy leagues cannot select the LCK patch. |
| P0 | Repair deferred TypeScript errors | 17 errors fixed without suppression; `npm run typecheck` passes and is required in CI. Runtime validation remains intact. |
| P0 | Correct stale-source recovery guidance | Watchdog keeps `UNHEALTHY` but returns `WAIT_FOR_SOURCE_RETRY_WINDOW` during a verified source backoff; due retries and separate stale schedules get actionable instructions. Six regression cases. |
| P0 | Strict draft file versions | Only string schema versions `2` and `3` are accepted. Numeric/array versions cannot enter inconsistent replay branches. Legacy Blue-first files remain supported. |
| P0 | Preserve the accepted publication on source rejection | Candidate history/outcomes no longer overwrite public heads before the Radar readiness gate passes. Regression covers both an existing publication and an empty feed; rejected acquisition diagnostics remain available. |
| P1 | National-team observation review | [Analysis protocol](NATIONAL_TEAM_ANALYSIS.md): separate exact-player club baselines, thirteen sourced partial observations with USA/Vietnam series selection, team hypotheses and local criteria/outcome journal. No inferred full drafts, national-team accuracy or certified pre-registration. |
| P1 | Consolidate implemented vs planned scope | README now identifies working features and labels future scope. This ledger is linked from README/ROADMAP. |
| P1 | Package measured case study | [Submission package](SUBMISSION_PACKAGE.md) records first-pick coverage correction, benchmark limits and the decision to retain production v2. |
| P1 | Staff brief and demo handoff | Dated three-page PDF, 3-minute draft demo script and evidence-bounded resume wording. Explicit public-asset allowlist and byte-equality checks ensure both Worker and Pages ship the reviewed PDF. No staff-time or accuracy improvement claim. |
| P1 | Regression and release | Python 210 tests, frontend 63 tests, Pages 2 tests, lint and whole-project type checking are release checks. CI and production deployment are required before closure. |

## Previously completed foundations

| Roadmap area | Verified implementation |
| --- | --- |
| 0-2: evidence, ingestion, baseline | Registry policies, immutable raw history, normalized models, leakage guards, deterministic fixtures/baselines, real OE import and guarded publication. Phase 1 issue #2 is implemented; its original limitations describe that historical milestone. |
| 3: historical evaluation plumbing | Walk-forward benchmark, public readiness gates and local human decision journal/outcome matching. Draft pilot and overlapping expanded replay published separately. |
| 5: player history | Bounded observed player/role champions; no unvalidated familiarity or test-cost score is promoted. |
| 6-7: review workflow | Human-vs-AI evaluator, 30-case human task deck, rule-based evidence briefs, creator scene exports and public-only player answers. AI gate remains closed. |
| 8: private boundary | Own-team device-local practice validation, duplicate/identity guards and no opponent/private mixing; synthetic regression coverage. Real private integration is not implied. |
| 9: prototype | Deployed app, source repository, proof page, dated brief, case study, demo script and resume draft. |
| Draft / Worlds | Staging before confirm; deterministic preview; separate first pick/map side; multi-set Fearless; validated local sessions; exact-team opponent shortcuts; observed role champions and locks; 100-action synthetic series validation. |

## Unmet evidence and external gates

| Priority | Item | Current evidence / exit condition |
| --- | --- | --- |
| P0 | Source freshness incident #58 | Publication recovered September 20 after reviewed mappings and LCK patch selection: accepted cutoff September 15 22:11 UTC / 16.16, with all ten LCK teams and six national-player club baselines. Source still delayed; next permitted attempt September 21 08:37 UTC. The September 20 hosted run published successfully and retained failed health because the source is stale. Keep #58 open until freshness recovers; do not bypass the interval. |
| P1 | Worlds common Fearless clauses | Official library access returned 404. Need accessible current international rulebook text; regional/prior-year rules cannot substitute. |
| P1 | Worlds champion restrictions | Event rules §5.1 promise a list to teams; no public named list verified. No event-specific restrictions are applied. Need authoritative named list before enabling. |
| P1 | Remaining qualifiers / actual matchup | Official English overview names 13 teams as of September 21; six slots remain unnamed on that page. Need explicit official qualifiers/seeds/fixtures; do not infer absence of qualification or seed order. |
| P1 | Worlds patch evidence | Event rulebook specifies 26.20; stored analysis is 16.16. Need actual 26.20 observations, not renamed season data. |
| P1 | Disjoint target-league draft evaluation | Earlier archived captures and verified match labels are required. Existing expanded cohort overlaps its predecessor; LCK role/production top-three both 4/35. |
| P1 | Later-set historical accuracy | Need verified series identity, complete preceding drafts and earlier source availability. Synthetic five-set tests prove behavior only. |
| P1 | Blind Spot real-history maturity | Need distinct chronological states and matured outcome windows; `HISTORY_NOT_READY` remains accurate. |
| P1 | Paired human / provider evaluation | Need real human selections, held-out reference grading, authorized provider setup and 30 paired cases. Do not fabricate analyst labels or unlock AI. |
| P2 | Expert/OTP and custom sources | Each adapter requires an approved source-specific contract, provenance and independent usefulness evaluation. No arbitrary scraping adapter is enabled. |
| P2 | Familiarity / test-cost proxy | Observed champion counts alone cannot establish skill or readiness. Require external validation or retain descriptive history. |
| P2 | Counter/synergy and historical analogues | Need maintained patch/role-specific evidence and disjoint evaluation; no invented weights. |
| P2 | Multi-agent and generative strategy | Depends on paired baseline evidence, provider credentials and measured added value. Keep current deterministic workflow until gates pass. |
| P2 | Real private adapter / long-form publication | Requires authorized private team data or analyst review. Existing local boundary and creator drafts do not authorize unattended publication. |
| P2 | Measured user utility / recorded demo | Staff review-time study and actual narrated recording require participant input. Script and PDF are ready; no recording or measured time saving is claimed. |

## Reproduction and restart order

1. Run `python -m pytest`, `python -m ruff check src tests`, `python -m ruff format --check src tests`.
2. In `web`, run `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:pages`.
3. Use public `collection-status.json` and the watchdog action. Never bypass the source interval.
4. On new official information or eligible observations, update the relevant dated snapshot and tests.
5. Evaluate new evidence separately; preserve all previously published aggregates.

No unresolved research gate should be converted into a fabricated implementation-complete claim.
