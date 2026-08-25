# Meta Radar web dashboard

Interactive analyst UI for the deterministic `MetaRadarReport` schema produced by the Python core.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The onboarding home separates the product into four focused workspaces:

- `/team/` — own-team selection, opponent priority, review candidates, and Draft Battlecard.
- `/t1/` — official T1 fixture, one-page staff brief, target profile, and match-day control.
- `/creator/` — evidence-locked YouTube, Shorts, and editor JSON exports.
- `/radar/` — full regional signal, audit, history, and raw evidence exploration.

Each workspace requests the same-origin
`/feed/current.json`, `/feed/schedule.json`, and `/feed/schedule-changes.json`, checks their schemas,
and rechecks them every five
minutes. The bundled match feed is the latest reviewed real provider snapshot and includes its
publication-readiness audit. The official schedule companion is used only to prioritize team review;
it is excluded from scoring after 36 hours without a successful refresh. The UI shows excluded-game
and blocking-issue counts instead of presenting a clean-looking result without its data limitations.
The visible surface is selected by the page route rather than by asking a new user to understand one
large dashboard. Direct links remain loadable on both the local app and GitHub Pages.

After choosing an own team, **분석 링크 복사** creates an account-free URL containing the public
team and opponent selections. Opening it restores the same evidence context; no API key, uploaded
file, or private note is included. Shared staff links open the focused T1 workspace directly.

The **T1 원페이지 브리프** is the meeting handoff for that workspace. It keeps the official fixture,
three public-data review actions, five readiness gates, T1 pick/ban focus, and—only after a verified
head-to-head exists—the five-lane review order on one printable surface. Its PDF mode excludes the
rest of the dashboard and retains the unknowns and evidence boundary.

Use **JSON 불러오기** for a temporary local override created by:

```bash
python -m pro_meta_intelligence build-radar --input path/to/oracles-elixir.csv
```

Imported files stay in browser memory and are not uploaded or persisted. The refresh button returns
from a local override to the published feed. Host access control is separate from application data;
the dashboard itself has no product-account connection flow.

Creator Export Lab converts an eligible Radar candidate into a 1280×720 YouTube card, a 1080×1920
short-form card, or scene JSON. The browser generates the files locally. Experimental
HTML-in-Canvas is used only when detected; all other browsers use the built-in Canvas 2D fallback.

Creator Storyboard v1 also loads the matching published Creator brief and arranges its approved
claims into five scenes: hook, change, review value, counterpoint, and next check. Editors can choose
an approved title, inspect each scene's voiceover and claim IDs, copy a 30–60 second script, and
export the complete packet as Markdown or JSON. The local review checklist never marks the source
artifact publication-ready; final factual and editorial approval remains human.

The default Creator lens is T1-first. It intersects exact champion-role Radar candidates with exact
T1 public pick events, then shows the T1 sample, observed games, observed players when available, and
separate T1/global evidence counts. The global Creator brief remains one switch away. If there is no
direct overlap, the UI stays global rather than implying that an unrelated global topic is about T1.

After selecting an own team, the Draft Battlecard compares that team's public priorities with the
selected opponent. It presents protect, exact pick-contest, deny-review, and exchange-scenario
questions, then exports the same evidence-bounded artifact as JSON. It never treats the result as an
automatic pick/ban instruction.

The default reading flow is intentionally progressive: choose a workspace, then complete its primary
task. Team Room moves from own-team selection to prioritized opponent and Draft Battlecard; the other
pages remove unrelated sections entirely. Mobile users get a persistent five-destination task bar
for home, team, T1, creator, and radar navigation.

Both the own-team and opponent selectors support instant filtering across team names, known aliases,
and league labels. The selected record stays visible while a new search is in progress, and changing
the own team clears stale search state before recalculating the opponent queue.

T1 is the default opponent target for the product. Initial load, feed refresh, and local report import
select the exact T1 organization when it is present. After an own team is selected, T1 remains pinned
at the front of the visible preparation queue unless T1 itself is the own team. This presentation pin
does not modify the opponent-priority score, official-schedule evidence, or exported facts.

When the exact T1 record is selected, Target Profile adds the latest publicly observed five-player
lineup, same-patch player champion pools, five recent games, and previous-patch champion-role
changes. Other same-patch lineups stay counted but are separated from the latest five. The provider
does not expose a stable series ID, so the interface labels these records as games and does not
invent series groupings. The complete bounded profile is downloadable as JSON.

The pinned T1 Match-Day Control independently finds T1's next verified official fixture. It labels
the other participant as TBD until the schedule source resolves it, distinguishes a confirmed
head-to-head from a T1 fixture involving another team, and exposes each readiness gate instead of
hiding missing data behind one score. Once the participant changes in the refreshed schedule, the
same deterministic brief updates automatically. Its schedule event ID remains separate from
historical game and series IDs, and the complete brief is downloadable as JSON.

The schedule watch runs through a dedicated GitHub workflow every eight hours, within the reviewed
six-hour source interval. It publishes only the normalized schedule and T1 change log. The Match-Day
Control shows the last check, latest detected change, and retained-change count; a missing log is
reported as unavailable rather than treated as “no change.”

Once the fixture participant is confirmed and the selected own team is in that match, Match-Day
Control adds a five-lane collision report. It orders lanes using disclosed public-draft components,
shows available current-player names, separates shared picks, protect candidates, and opponent
priorities, and writes the result into the downloadable Match-Day JSON. If either side lacks the
latest-public-match five-role profile, the report says `TEAM-LEVEL LIMITED`; it never fills missing
players from schedule guesses or community rosters. Recent-game timelines, patch deltas, and series
diagnostics remain T1-only, keeping the all-team role profiles bounded.

## Checks

```bash
npm run lint
npm test
```

The production build targets Cloudflare-compatible ESM through vinext and the Sites Vite plugin.

## Independent public URL

The same product also ships as a static GitHub Pages build at
`https://mosejong.github.io/pro-meta-intelligence/`. It has no application login and loads the
bundled feed relative to each direct workspace path, so every page uses the same dashboard and data
contract.

```bash
npm run test:pages
```
