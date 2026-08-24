# Meta Radar web dashboard

Interactive analyst UI for the deterministic `MetaRadarReport` schema produced by the Python core.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The dashboard first requests the same-origin
`/feed/current.json` and `/feed/schedule.json`, checks both schemas, and rechecks them every five
minutes. The bundled match feed is the latest reviewed real provider snapshot and includes its
publication-readiness audit. The official schedule companion is used only to prioritize team review;
it is excluded from scoring after 36 hours without a successful refresh. The UI shows excluded-game
and blocking-issue counts instead of presenting a clean-looking result without its data limitations.
Use **JSON 불러오기** for a temporary local override created by:

```bash
python -m pro_meta_intelligence build-radar --input path/to/oracles-elixir.csv
```

Imported files stay in browser memory and are not uploaded or persisted. The refresh button returns
from a local override to the published feed. Host access control is separate from application data:
the dashboard itself has no ChatGPT, OpenAI, or product-account login flow.

Creator Export Lab converts an eligible Radar candidate into a 1280×720 YouTube card, a 1080×1920
short-form card, or scene JSON. The browser generates the files locally. Experimental
HTML-in-Canvas is used only when detected; all other browsers use the built-in Canvas 2D fallback.

After selecting an own team, the Draft Battlecard compares that team's public priorities with the
selected opponent. It presents protect, exact pick-contest, deny-review, and exchange-scenario
questions, then exports the same evidence-bounded artifact as JSON. It never treats the result as an
automatic pick/ban instruction.

The default reading flow is intentionally progressive: select the own team, review the prioritized
opponent, then read the Draft Battlecard. Historical collection gates and raw opponent pick/ban,
side, rotation, and evidence tables stay collapsed until requested. Mobile users get a persistent
four-destination task bar instead of losing navigation when the desktop header is hidden.

Both the own-team and opponent selectors support instant filtering across team names, known aliases,
and league labels. The selected record stays visible while a new search is in progress, and changing
the own team clears stale search state before recalculating the opponent queue.

## Checks

```bash
npm run lint
npm test
```

The production build targets Cloudflare-compatible ESM through vinext and the Sites Vite plugin.

## Independent public URL

The same dashboard also ships as a static GitHub Pages build at
`https://mosejong.github.io/pro-meta-intelligence/`. This address has no application login and no
ChatGPT-branded hostname. It loads the bundled feed relative to the project path, so the Sites and
GitHub Pages builds use the same dashboard and data contract.

```bash
npm run test:pages
```
