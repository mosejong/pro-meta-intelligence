import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

async function withVite(run) {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false,
    publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try { await run(vite); } finally { await vite.close(); }
}

const source = () => readFile(new URL("../app/draft-lab.tsx", import.meta.url), "utf8");
const openTag = (html, cls) => html.match(new RegExp(`<(?:section|div)[^>]*class="${cls}"[^>]*>`))?.[0];

test("start gate: explicit start only with ready data, two distinct valid teams, no import/room", async () => {
  await withVite(async (vite) => {
    const F = await vite.ssrLoadModule("/app/team-selection-flow.ts");
    const base = { dataReady: true, importing: false, roomActive: false, blueTeamId: "a", redTeamId: "b", teamIds: ["a", "b", "c"] };
    assert.equal(F.draftStartBlock(base), null, "ready defaults may start, but only via the explicit button");
    assert.equal(F.draftStartBlock({ ...base, dataReady: false }), "NOT_READY");
    assert.equal(F.draftStartBlock({ ...base, importing: true }), "IMPORTING");
    assert.equal(F.draftStartBlock({ ...base, roomActive: true }), "ROOM_ACTIVE");
    assert.equal(F.draftStartBlock({ ...base, redTeamId: "a" }), "SAME_TEAM");
    assert.equal(F.draftStartBlock({ ...base, redTeamId: "" }), "MISSING_TEAM");
    assert.equal(F.draftStartBlock({ ...base, blueTeamId: "gone" }), "MISSING_TEAM", "an unknown team ID is invalid");
    assert.equal(F.draftStartBlock({ ...base, teamIds: [] }), "MISSING_TEAM");
    for (const code of ["NOT_READY", "IMPORTING", "ROOM_ACTIVE", "MISSING_TEAM", "SAME_TEAM"]) assert.ok(F.DRAFT_START_BLOCK_TEXT[code], code);
    // No roster/simulation input exists in the gate at all.
    assert.deepEqual(Object.keys(base).sort(), ["blueTeamId", "dataReady", "importing", "redTeamId", "roomActive", "teamIds"]);

    assert.equal(F.boardInteractive(true, "DRAFT"), true);
    assert.equal(F.boardInteractive(true, "SETUP"), false, "setup never runs board actions");
    assert.equal(F.boardInteractive(false, "DRAFT"), false);
  });
});

test("startup restore: work resumes on the draft step, an empty autosave keeps the setup gate", async () => {
  await withVite(async (vite) => {
    const F = await vite.ssrLoadModule("/app/team-selection-flow.ts");
    const empty = { selections: [], stagedChampion: null, games: [] };
    assert.equal(F.sessionHasDraftWork(empty), false);
    assert.equal(F.sessionHasDraftWork({ ...empty, positions: {} }), false);
    assert.equal(F.sessionHasDraftWork({ ...empty, positions: { t: { roles: { TOP: null }, unassigned: [] } } }), false);
    assert.equal(F.sessionHasDraftWork({ ...empty, selections: [{}] }), true);
    assert.equal(F.sessionHasDraftWork({ ...empty, stagedChampion: "Ahri" }), true);
    assert.equal(F.sessionHasDraftWork({ ...empty, games: [{}] }), true);
    assert.equal(F.sessionHasDraftWork({ ...empty, positions: { t: { roles: { TOP: "Aatrox" }, unassigned: [] } } }), true);
    assert.equal(F.sessionHasDraftWork({ ...empty, positions: { t: { roles: {}, unassigned: ["Aatrox"] } } }), true);
  });
});

test("deep links: only existing #draft= / #room= fragments route to the draft step", async () => {
  await withVite(async (vite) => {
    const F = await vite.ssrLoadModule("/app/team-selection-flow.ts");
    assert.equal(F.isDraftDeepLink("#draft=abc"), true);
    assert.equal(F.isDraftDeepLink("#room=abc"), true);
    for (const hash of ["", "#", "#draft", "#experiment=x", "#draft-workspace", "#rooms"]) assert.equal(F.isDraftDeepLink(hash), false, hash);
  });
  const lab = await source();
  const route = lab.slice(lab.indexOf("const route = () =>"), lab.indexOf("// Explicit start/back only"));
  assert.match(route, /isDraftDeepLink\(window\.location\.hash\)/);
  assert.match(route, /window\.setTimeout\(route, 0\)/, "deferred: no render-time window read / hydration mismatch");
  assert.doesNotMatch(route, /location\.hash\s*=|replaceState|pushState|restoreSession|onAccept/, "no fragment mutation, no auto-accept");
});

test("fresh SSR: only team selection is visible; the studio stays mounted but hidden and inert", async () => {
  await withVite(async (vite) => {
    const { LocaleProvider } = await vite.ssrLoadModule("/app/locale.tsx");
    const { DraftLab } = await vite.ssrLoadModule("/app/draft-lab.tsx");
    const { ChampionNameProvider } = await vite.ssrLoadModule("/app/champion-names.tsx");
    const { sampleReport } = await vite.ssrLoadModule("/app/sample-report.ts");
    const html = renderToStaticMarkup(createElement(LocaleProvider, {}, createElement(ChampionNameProvider, null,
      createElement(DraftLab, { currentSpace: "DRAFT", report: sampleReport, feedLabel: "TEST FEED" }))));
    const setup = openTag(html, "draft-flow-setup");
    const draft = openTag(html, "draft-flow-draft");
    assert.ok(setup && draft);
    assert.doesNotMatch(setup, /\shidden=|\sinert=/, "setup step is visible and interactive");
    assert.match(draft, /\shidden=""/);
    assert.match(draft, /\sinert=""/);
    assert.equal(html.match(/id="draft-workspace"/g)?.length, 1, "one stable target, no duplicate IDs");
    assert.match(setup, /id="draft-workspace"/, "target points at the visible setup step");
    assert.match(html, />밴픽 시작<\/button>/);
    assert.doesNotMatch(html, />밴픽 이어가기</, "fresh visit has no work to continue");
    // Session is not ready during SSR, so the start is disabled with a reason.
    assert.match(html, /<button type="button" class="draft-flow-primary" disabled=""/);
    assert.match(html, /id="draft-flow-start-note"/);
    // Big team pickers render once, only inside the setup step; the studio and every panel stay mounted.
    assert.equal(html.match(/class="draft-match-setup"/g)?.length, 1);
    const setupAt = html.indexOf('class="draft-flow-setup"');
    const draftAt = html.indexOf('class="draft-flow-draft"');
    const chooser = html.indexOf('class="draft-match-setup"');
    assert.ok(setupAt < chooser && chooser < draftAt, "TeamChooser is not part of the draft step");
    for (const id of ["studio-panel-draft", "studio-panel-roster", "studio-panel-details", "studio-panel-comparison", "studio-panel-simulation"]) {
      assert.ok(html.indexOf(`id="${id}"`) > draftAt, `${id} stays mounted inside the draft step`);
    }
    assert.match(html, />팀 선택으로<\/button>/);
    // The full header intro is hidden on setup (the setup heading/stepper replace it) and the Riot notice stays.
    assert.match(html, /<header class="studio-workspace-header">[\s\S]*?<p[^>]*hidden=""[^>]*>[^<]+<\/p>/);
    assert.match(html, /<footer class="studio-preview-footer"[\s\S]*?isn&#x27;t endorsed by Riot Games|<footer class="studio-preview-footer"[\s\S]*?isn't endorsed by Riot Games/);
    assert.match(openTag(html, "draft-stage") ?? html.match(/<section class="draft-stage"[^>]*>/)[0], /inert=""/, "board gate closed on setup");
  });
});

test("draft step order: matchup, minimal context, then the board; management follows the board in DOM order", async () => {
  await withVite(async (vite) => {
    const { LocaleProvider } = await vite.ssrLoadModule("/app/locale.tsx");
    const { DraftLab } = await vite.ssrLoadModule("/app/draft-lab.tsx");
    const { ChampionNameProvider } = await vite.ssrLoadModule("/app/champion-names.tsx");
    const { sampleReport } = await vite.ssrLoadModule("/app/sample-report.ts");
    const html = renderToStaticMarkup(createElement(LocaleProvider, {}, createElement(ChampionNameProvider, null,
      createElement(DraftLab, { currentSpace: "DRAFT", report: sampleReport, feedLabel: "TEST FEED" }))));
    const at = (needle) => { const index = html.indexOf(needle); assert.ok(index >= 0, needle); return index; };
    const panel = at('id="studio-panel-draft"');
    const matchup = at('class="draft-flow-matchup"');
    const solo = at('class="solo-draft"');
    const context = at('class="draft-series draft-series-context"');
    const stage = at('class="draft-stage"');
    const management = at('class="draft-series draft-series-management"');
    const panelEnd = at('id="studio-panel-roster"');
    assert.ok(matchup < panel && panel < solo && solo < context && context < stage, "matchup, auto/side, first-selection/Fearless, then board");
    assert.ok(stage < management && management < panelEnd, "management sits below the board inside the draft panel");
    // Room, share, series reset, named practice and file controls all render after the board, never before it.
    const secondary = html.slice(management, panelEnd);
    for (const needle of ['class="draft-room"', 'class="draft-share', 'class="draft-session-details"', 'class="draft-series-actions"']) {
      assert.ok(secondary.includes(needle), `${needle} in management`);
      assert.ok(html.slice(panel, stage).indexOf(needle) === -1, `${needle} not above the board`);
    }
    assert.ok(secondary.includes('class="draft-first-selection"') === false && html.slice(context, stage).includes('class="draft-first-selection"'));
    // Labels stay unique (the old series label stays on the context strip).
    for (const label of ["혼자 밴픽 연습", "밴픽 관리·공유"]) assert.equal(html.split(`aria-label="${label}"`).length - 1, 1, label);
    assert.equal(html.match(/id="draft-workspace"/g)?.length, 1);
  });
  const lab = await source();
  // The save-failed recovery banner stays in the context strip above the board (the header shortcut targets it).
  const contextSrc = lab.slice(lab.indexOf('className="draft-series draft-series-context"'), lab.indexOf('className="draft-stage"'));
  assert.match(contextSrc, /className="draft-save-failed" role="alert"/);
  assert.doesNotMatch(contextSrc, /<DraftRoomPanel|<DraftSharePanel|<DraftPracticeLibraryPanel|draft-session-details/);
  assert.doesNotMatch(lab, /\border:\s*-?\d/, "no CSS/inline visual reordering");
  const css = await readFile(new URL("../app/draft-studio.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /draft-series-management[^}]*\border\s*:/);
});

test("source guards: board gate, paused auto/timer, back preservation and existing entry paths", async () => {
  const lab = await source();
  assert.match(lab, /const \[step, setStep\] = useState<DraftFlowStep>\("SETUP"\)/, "fresh visit starts on setup; defaults never auto-start");
  assert.match(lab, /const boardActive = boardInteractive\(canSelect, step\);/);
  // Auto opponent: gate + dependency, so the pending 600ms timer is cleared when the step leaves DRAFT.
  assert.match(lab, /if \(!autoChoice \|\| !boardActive \|\| pendingReset \|\| studioTab !== "DRAFT" \|\| room\.active\) return;/);
  assert.match(lab, /\}, \[autoChoice, boardActive, pendingReset,/);
  assert.match(lab, /if \(!timerRunning \|\| !turn \|\| timer <= 0 \|\| step !== "DRAFT"\) return;/);
  assert.match(lab, /\}, \[timer, timerRunning, turn, step\]\);/);
  assert.match(lab, /function chooseChampion[\s\S]{0,80}!boardActive/);
  assert.match(lab, /function confirmChampion\(\) \{\s*if \(!roomCanAct \|\| !boardActive/);
  assert.equal((lab.match(/importing \|\| step !== "DRAFT"\) return;/g) ?? []).length, 2, "role assign/confirm blocked on setup");
  assert.match(lab, /className="draft-stage"[^>]*inert=\{!boardActive\}/);
  // Back: no reset, timer paused, not available while a room owns the board.
  const back = lab.slice(lab.indexOf("function backToSetup()"), lab.indexOf("function undo()"));
  assert.match(back, /if \(room\.active\) return;/);
  assert.match(back, /setTimerRunning\(false\)/);
  assert.doesNotMatch(back, /setSelections|setGames|resetDraft|resetSeries|setPositionState|setLiveRoster|setComparisonEpoch|setAutoHistory|setSeriesReport|setPendingChampion/);
  const start = lab.slice(lab.indexOf("function enterDraft()"), lab.indexOf("function backToSetup()"));
  assert.match(start, /if \(startBlock\) return;/);
  assert.doesNotMatch(start, /setSelections|setGames|resetDraft|setBlueTeamId|setRedTeamId/);
  // Team changes keep the existing guards; the optional new series reuses the existing confirmation.
  assert.match(lab, /if \(games\.length \|\| hasCurrentWork\) return;/);
  assert.match(lab, /className="draft-flow-secondary" onClick=\{\(\) => setPendingReset\("SERIES"\)\}/);
  // Startup restore: only a session with work skips setup; notes/auto-off semantics unchanged.
  const startup = lab.slice(lab.indexOf("readLocalDraftForRestore().then"), lab.indexOf("}, [restoreSession]);"));
  assert.match(startup, /if \(sessionHasDraftWork\(saved\.session\)\) setStep\("DRAFT"\);/);
  assert.doesNotMatch(startup, /setSoloEnabled\(true\)/);
  // Existing entry paths show the draft step; room/startup generation guards stay first.
  assert.match(lab, /onRoomChange=\{next => \{ setRoom\(next\); if \(next\.active\) \{ restoreGeneration\.current \+= 1; setStep\("DRAFT"\);/);
  assert.match(lab, /onSnapshot=\{\(session, reset\) => \{\s*restoreGeneration\.current \+= 1;[\s\S]{0,600}setStep\("DRAFT"\);\s*\}\} \/>/);
  assert.match(lab, /onAccept=\{\(session\) => \{ if \(room\.active\) return;[^}]*restoreSession\(session\); setStep\("DRAFT"\); \}\}/);
  assert.match(lab, /restoreSession\(result\.session\);\s*setStep\("DRAFT"\);/, "file import");
  assert.match(lab, /if \(room\.active\) return;\s*setComparisonEpoch\(\(epoch\) => epoch \+ 1\); setPendingReset\(null\); restoreSession\(session\); setStep\("DRAFT"\);/, "named practice load");
  // The header save-failed flag is an explicit shortcut: it reveals the draft step before focusing the retry.
  assert.match(lab, /function focusSaveRetry\(\) \{\s*setStep\("DRAFT"\);\s*showStudioTab\("DRAFT", \(\) => \{/);
  assert.match(lab, /className="studio-save-flag"[^>]*onClick=\{focusSaveRetry\}/);
  // Only explicit user paths or existing entry handlers switch steps; background save/autosave callbacks never do.
  assert.doesNotMatch(lab.slice(lab.indexOf("const retrySave = useDraftSave"), lab.indexOf("const shareSession")), /setStep/);
  // Focus moves to headings by ref only on explicit start/back.
  assert.match(lab, /stepFocus\.current = "DRAFT";\s*setStep\("DRAFT"\);/);
  assert.match(lab, /stepFocus\.current = "SETUP";\s*setStep\("SETUP"\);/);
  assert.match(lab, /heading\?\.focus\(\{ preventScroll: true \}\);\s*scrollIntoViewGently\(heading\);/);
});

test("boundaries: the flow adds no storage, schema, share, room or model changes", async () => {
  const flow = await readFile(new URL("../app/team-selection-flow.ts", import.meta.url), "utf8");
  assert.doesNotMatch(flow, /^import /m, "pure helper with no imports");
  assert.doesNotMatch(flow, /indexedDB|localStorage|sessionStorage|fetch\(|window|document|history/);
  const lab = await source();
  assert.doesNotMatch(lab, /step[^\n]*serializeDraftScenario|serializeDraftScenario\([^)]*step/, "step is never serialized");
  for (const file of ["draft-session.ts", "draft-share.ts", "draft-room-client.ts", "solo-review-autosave.ts"]) {
    const text = await readFile(new URL(`../app/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /team-selection-flow|DraftFlowStep/, `${file} unchanged by the flow`);
  }
});
