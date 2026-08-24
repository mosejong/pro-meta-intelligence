# Creator Export Lab

## Purpose

Creator Export Lab turns an eligible Meta Radar entry into a deterministic visual scene for an
analyst-reviewed video workflow. It does not generate a new analytical claim. The title, hook,
metrics, counterpoint, source IDs, patch, and cutoff all come from the same published Radar evidence
used by Team Mode.

The first output formats are:

- 1280×720 PNG for a 16:9 YouTube scene;
- 1080×1920 PNG for a 9:16 short-form scene;
- `creator-visual-scene` JSON for an editor, motion template, or later script pipeline.

Files are generated in the browser and are not uploaded to the application server.

## Scene contract

Every scene includes:

- champion, role, Radar rank, patch, and cutoff;
- a deterministic title and evidence-bounded hook;
- team-demand change, pick-presence change, recent adopting teams, and current presence;
- the existing Team Decision Brief counterevidence;
- exact source event IDs and their count;
- a visible boundary that the scene is not an automatic stage-pick recommendation.

The JSON is a production handoff, not a publication approval. A human still decides framing,
voiceover, final wording, music, and whether the evidence is strong enough to publish.

## Rendering strategy

The exporter feature-detects the proposed HTML-in-Canvas primitives. When `drawElementImage()` is
available, it attempts to paint the same HTML scene into a canvas. A paint timeout, unsupported API,
cross-origin readback restriction, or export failure automatically falls back to a conventional
Canvas 2D renderer.

The fallback is the current production path. It uses the same `CreatorScene` values and fetches a
Riot Data Dragon splash image with CORS before drawing it. If the image is unavailable, the exporter
keeps the full evidence card and substitutes the product color field instead of failing the scene.

HTML-in-Canvas remains an incubating browser proposal and must not become a required dependency for
the public dashboard until interoperable browser support exists. See the
[WICG explainer](https://github.com/WICG/html-in-canvas) and
[Chrome origin-trial overview](https://developer.chrome.com/blog/html-in-canvas-origin-trial).

## Explicit non-goals

- unattended video publication;
- AI-written facts not present in the approved analysis artifact;
- automatic voice, music, or footage licensing decisions;
- hiding counterevidence to make a stronger thumbnail claim;
- treating experimental browser support as a production requirement.

The next Creator Mode gate is a multi-scene storyboard with claim order, chart specifications,
voiceover notes, and a final human approval state.
