# Studio side tabs: result (2026-11-18)

Spec: `docs/CLAUDE_STUDIO_SIDETABS_TASK.md`. No commit, push, deploy, new data or weight changes.

최종 Codex 검토와 실제 검사 결과는 [통합 검토](STUDIO_SIDETABS_REVIEW_2026-11-18.md)를 따른다. 아래 'None'과 미확인은 Claude 구현 시점의 기록이며 부모는 그 뒤 실제 빌드·UI 검사와 보완을 완료했다.

## What changed

The single long page is now five real tab panels: Draft, Roster (선수·로스터), Details (상세 분석), A/B comparison (A/B 비교) and Simulation readiness (시뮬레이션 준비).
- **Team selection:** shared once above the panels. The match-setup section moved out of the draft panel.
- **Panel structure:**
  - Every panel stays mounted and switching only toggles the `hidden` attribute, so draft, timer, roster, baseline A, roles, the frozen input and replay state all survive tab switches.
  - Each panel has `role="tabpanel"` and `aria-labelledby`.
  - The tabs use `aria-controls`, `aria-selected` and a roving `tabIndex`.
  - Keys: Up/Down/Left/Right wrap around, plus Home and End.
- **Draft panel:** keeps progress, search, both sides' picks and bans, confirm, undo, set and save. Champion info moved to Details; the draft panel shows a small "챔피언 정보 보기" button. Clicking a confirmed ban or pick slot opens Details (read-only, it never stages a champion).
- **Save failure:** the save-failed alert stays in Draft. When a save fails, the shared header shows a red "저장 실패" button that jumps to Draft and focuses the retry button. It is never shown as a successful save.
- **Layout:**
  - At ≥1100px the rail sits on the left at 144px and stays sticky. Below 1100px it is a top horizontal strip: it scrolls sideways itself (never the page), tabs are at least 44px tall, and the selected tab is kept in view, including when the window shrinks from wide to narrow.
  - `aria-orientation` follows the layout through `useSyncExternalStore(matchMedia)`. Server render says horizontal.
  - At ≥1450px the draft picker becomes one column, because champion info no longer fills the second column.

## Changed files

| File | Change |
|---|---|
| `web/app/draft-lab.tsx` | Five panels, shared team selection, rail keyboard handling, rail self-scroll, `inspectSlot` / `openChampionInfo` / `focusSaveRetry`, save-failed flag. `showStudioTab` and the Details→Draft staging behaviour are unchanged. |
| `web/app/draft-studio.css` | `.studio-shell` / `.studio-tabs` (mobile top strip, desktop left rail), panel padding, `.studio-info-entry`, `.studio-champion-info`, `.studio-save-flag`. No CSS overrides `hidden`. |
| `web/app/locale-messages.ts` | New keys (ko/zh-CN): `draft.tab.ROSTER`, `draft.tab.COMPARISON`, `draft.tab.SIMULATION`, `draft.championInfoOpen`, `draft.saveFailedFlag`. |
| `web/tests/rendered-html.test.mjs` | Static checks moved to the new structure: rail order, which panel is visible, the shared setup appears once, each module sits in its own panel, the info button, champion info inside Details. Existing checks kept. |
| `web/tests/locale.test.mjs` | Chinese labels for the three new tabs and the info button. |
| `web/tests/e2e/studio-panels.mjs` (new) | `STUDIO_PANELS`, `studioTab`, `studioPanel`, `showPanel`: switch panels by clicking the real tab, then wait until it is selected and visible. |
| `web/tests/e2e/studio-sidetabs.spec.mjs` (new) | Entry state and page length; draft, timer and roster round trip; baseline A and roles round trip; keyboard and roving focus; desktop left rail and mobile no-overflow with screenshots; slot click and info button open Details. |
| `web/tests/e2e/{draft-studio,roster-workshop,simulation-readiness,simulation-player-evidence,player-pool,player-season}.spec.mjs` | Added real tab switches (`showPanel`) only. No assertions deleted, no forced unhiding, no retries, no test-only UI. |

`web/tests/e2e/studio-layout-review.spec.mjs` was added by someone else and was not edited. To meet it (selected tab stays visible after desktop → narrow), I added `railVertical` to the dependencies of the rail-scroll effect.

## Checks run

**None.** Every Bash run of typecheck, lint, tests or build was blocked by "requires approval". Per the spec, I did not work around the block. I edited files only with the edit tools.

## Checks for the parent to run, in this order

```sh
cd web
npm test                      # or, if already built: node --test tests/rendered-html.test.mjs tests/locale.test.mjs
npm run typecheck
npm run lint
npm run build:pages
npx playwright test tests/e2e/studio-sidetabs.spec.mjs tests/e2e/studio-layout-review.spec.mjs \
  tests/e2e/draft-studio.spec.mjs tests/e2e/roster-workshop.spec.mjs tests/e2e/simulation-readiness.spec.mjs \
  tests/e2e/simulation-player-evidence.spec.mjs tests/e2e/player-pool.spec.mjs tests/e2e/player-season.spec.mjs
```

Screenshots are saved to the test output folder as `studio-sidetabs-{desktop,mobile-width}.png` and `studio-sidetabs-roster-*.png`. The page-length figures are recorded in the `page-length` annotation.

## Unconfirmed (not verified because nothing ran)

- **Hydration:** `aria-orientation` is horizontal on the server and becomes vertical on desktop after hydration. I expect no mismatch warning because I used the `useSyncExternalStore` server snapshot, but this was not checked.
- **Page-length threshold:** "less than 200px below the selected panel" is an estimate. The fixed bottom nav padding (78px), the footer and the closed dialog are not measured. If it fails, check the actual value in the annotation.
- **Sticky rail:** the mobile top strip's sticky behaviour, and the rail versus the bottom nav, are verified only by bounding-box assertions. Nobody has looked at it.
- **Visual result:** the rail's look (gold accent, borders) has not been checked by eye or in a screenshot.
- **Existing specs:** the point where each switches tabs was placed by reading the code, so a real run may show a missing switch.
- **Unaffected specs:** `workspace-storage`, `publication-reliability`, `neutral-navigation` and `local-report-reliability` only touch elements in the Draft panel or the shared area, so I left them unchanged. Not run.
