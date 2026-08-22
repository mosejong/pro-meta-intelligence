# Meta Radar web dashboard

Interactive analyst UI for the deterministic `MetaRadarReport` schema produced by the Python core.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, then use **JSON 불러오기** to load a report created by:

```bash
python -m pro_meta_intelligence build-radar --input path/to/oracles-elixir.csv
```

The bundled snapshot is synthetic and visibly marked as a demo. Imported files stay in browser
memory; this version does not upload or persist them.

## Checks

```bash
npm run lint
npm test
```

The production build targets Cloudflare-compatible ESM through vinext and the Sites Vite plugin.
