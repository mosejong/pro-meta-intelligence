# Meta Radar web dashboard

Interactive analyst UI for the deterministic `MetaRadarReport` schema produced by the Python core.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The dashboard first requests the same-origin
`/feed/current.json`, checks the report schema, and rechecks it every five minutes. The bundled feed
is the latest reviewed real provider snapshot and includes its publication-readiness audit. The UI
shows excluded-game and blocking-issue counts instead of presenting a clean-looking result without
its data limitations. Use **JSON 불러오기** for a temporary local override created by:

```bash
python -m pro_meta_intelligence build-radar --input path/to/oracles-elixir.csv
```

Imported files stay in browser memory and are not uploaded or persisted. The refresh button returns
from a local override to the published feed. Host access control is separate from application data:
the dashboard itself has no ChatGPT, OpenAI, or product-account login flow.

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
