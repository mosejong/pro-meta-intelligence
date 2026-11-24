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

test("completed result: optional simulation link is navigation only, hidden without callback, follows disabled", async () => {
  await withVite(async (vite) => {
    const { DraftResultPanel } = await vite.ssrLoadModule("/app/draft-result-panel.tsx");
    const { applyDraftSelection } = await vite.ssrLoadModule("/app/draft-agent.ts");
    const { sampleReport } = await vite.ssrLoadModule("/app/sample-report.ts");
    const ids = ["Aatrox", "Ahri", "Akali", "Alistar", "Amumu", "Anivia", "Wukong", "Kai'Sa", "Ashe", "Azir",
      "Bard", "Braum", "Brand", "Caitlyn", "Camille", "Corki", "Darius", "Diana", "Draven", "Ekko"];
    const report = structuredClone(sampleReport);
    const [blueTeam, redTeam] = report.opponent_prep.teams;
    let selections = [];
    for (const id of ids) selections = applyDraftSelection(selections, id, [], "BLUE");
    const before = structuredClone(selections);
    const calls = [];
    const render = (extra) => renderToStaticMarkup(createElement(DraftResultPanel, { report, blueTeam, redTeam, selections, previousPicks: [],
      firstPickSide: "BLUE", nameOf: (id) => id, onReplay: () => calls.push("replay"), onNext: () => calls.push("next"), disabled: false, ...extra }));
    const button = (html) => html.match(/<button[^>]*class="draft-result-simulation"[^>]*>[^<]*<\/button>/)?.[0];

    const legacy = render({});
    assert.match(legacy, /id="draft-result"/, "fixture renders the READY result");
    assert.equal(button(legacy), undefined, "no callback (room mode) -> no simulation button");
    assert.equal((legacy.match(/<button/g) ?? []).length, 3, "legacy three actions unchanged");

    const linked = button(render({ onOpenSimulation: () => calls.push("sim") }));
    assert.ok(linked, "callback provided -> button rendered");
    assert.match(linked, /가정 시뮬레이션 준비/);
    assert.doesNotMatch(linked, /disabled/);
    assert.match(button(render({ onOpenSimulation: () => {}, disabled: true })), /disabled=""/, "follows the existing disabled flag");
    assert.deepEqual(calls, [], "rendering never invokes navigation or draft actions");
    assert.deepEqual(selections, before, "selections are not mutated");
  });
  const lab = await source();
  const helper = lab.slice(lab.indexOf("function openSimulationReadiness()"), lab.indexOf("/** Rail selection"));
  assert.match(helper, /showStudioTab\("SIMULATION"/);
  assert.doesNotMatch(helper, /set(?:Selections|Position|Solo|Timer|Pending|Roster|ReadyInput)|restoreSession|nextGame/, "navigation only");
  assert.match(lab, /onOpenRoleAssignment=\{openSimulationReadiness\}/, "A/B route shares the helper");
  assert.match(lab, /onOpenSimulation=\{room\.active \? undefined : openSimulationReadiness\}/, "room mode hides the link");
});

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
  // Phones scroll to the turn/picker area instead of the heading; focus still moves to the heading.
  assert.match(lab, /heading\?\.focus\(\{ preventScroll: true \}\);[\s\S]{0,400}scrollIntoViewGently\(phone \? controlRoom\.current : heading\);/);
});

test("practice mode helper: fresh manual, explicit intent, unchanged continue touches nothing, room forces manual", async () => {
  await withVite(async (vite) => {
    const F = await vite.ssrLoadModule("/app/team-selection-flow.ts");
    const manualBlue = { soloEnabled: false, manualSide: "BLUE" };
    const soloBlue = { soloEnabled: true, manualSide: "BLUE" };
    const soloRed = { soloEnabled: true, manualSide: "RED" };
    // Fresh default and the mode reflected on entering setup.
    assert.equal(F.currentPracticeMode(manualBlue), "MANUAL");
    assert.equal(F.currentPracticeMode({ soloEnabled: false, manualSide: "RED" }), "MANUAL", "a restored side alone is not solo");
    assert.equal(F.currentPracticeMode(soloBlue), "SOLO_BLUE");
    assert.equal(F.currentPracticeMode(soloRed), "SOLO_RED");
    // No pending choice (fresh, back->continue, restore/deep link/import/hash reset it): nothing changes.
    for (const state of [manualBlue, soloBlue, soloRed, { soloEnabled: false, manualSide: "RED" }]) {
      assert.equal(F.practiceModeChange(null, state, false), null, JSON.stringify(state));
    }
    // Re-selecting the actual mode is unchanged too: board, staged card, notes, timer and solo state are kept.
    assert.equal(F.practiceModeChange("MANUAL", manualBlue, false), null);
    assert.equal(F.practiceModeChange("SOLO_RED", soloRed, false), null);
    assert.equal(F.practiceModeChange("MANUAL", { soloEnabled: false, manualSide: "RED" }, false), null, "restored notes side untouched in manual");
    // Explicit intent: manual -> my RED vs auto BLUE (checkbox semantics: notes and timer cleared once).
    assert.deepEqual(F.practiceModeChange("SOLO_RED", manualBlue, false),
      { soloEnabled: true, manualSide: "RED", clearStaged: true, clearLastAuto: true, clearAutoNotes: true, stopTimer: true });
    assert.deepEqual(F.practiceModeChange("SOLO_BLUE", manualBlue, false),
      { soloEnabled: true, manualSide: "BLUE", clearStaged: true, clearLastAuto: true, clearAutoNotes: true, stopTimer: true });
    // Side switch while staying solo: side-select semantics only (notes and timer kept).
    assert.deepEqual(F.practiceModeChange("SOLO_RED", soloBlue, false),
      { soloEnabled: true, manualSide: "RED", clearStaged: true, clearLastAuto: true, clearAutoNotes: false, stopTimer: false });
    // Solo -> manual: checkbox-off semantics, side left as is.
    assert.deepEqual(F.practiceModeChange("MANUAL", soloRed, false),
      { soloEnabled: false, manualSide: "RED", clearStaged: true, clearLastAuto: true, clearAutoNotes: true, stopTimer: true });
    // Room: a setup choice can never enable the automatic opponent.
    for (const choice of [null, "MANUAL", "SOLO_BLUE", "SOLO_RED"]) {
      assert.equal(F.practiceModeChange(choice, manualBlue, true), null, `room ${choice}`);
      assert.equal(F.practiceModeChange(choice, soloRed, true)?.soloEnabled, false, `room forces off ${choice}`);
    }
  });
});

test("practice mode wiring: setup choice is a draft, applied once at the explicit start, never on load paths", async () => {
  const lab = await source();
  assert.match(lab, /const \[setupChoice, setSetupChoice\] = useState<PracticeMode \| null>\(null\);/, "fresh: follow the actual (manual) mode");
  assert.match(lab, /const \[soloEnabled, setSoloEnabled\] = useState\(false\);/);
  // Setup radios only change the draft choice: no solo/side/timer/clear side effects on SETUP.
  const fieldset = lab.slice(lab.indexOf('className="draft-flow-mode"'), lab.indexOf("</fieldset>"));
  assert.match(fieldset, /<legend>진행 방식<\/legend>/);
  assert.match(fieldset, /onChange=\{\(\) => setSetupChoice\(mode\)\}/);
  assert.doesNotMatch(fieldset, /setSoloEnabled|setManualSide|setAutoHistory|setPendingChampion|setTimerRunning|setLastAuto|setStep/);
  assert.match(fieldset, /disabled=\{room\.active \|\| !sessionReady \|\| importing\}/);
  assert.ok(lab.indexOf('className="draft-flow-mode"') < lab.indexOf('className="draft-flow-actions"'), "above the CTA");
  // Start: existing gate first; every change goes through the helper; clears are conditional, not unconditional.
  const start = lab.slice(lab.indexOf("function enterDraft()"), lab.indexOf("function backToSetup()"));
  assert.match(start, /if \(startBlock\) return;\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*const change = practiceModeChange\(setupChoice, \{ soloEnabled, manualSide \}, room\.active\);\s*if \(change\) \{/);
  assert.match(start, /if \(change\.clearAutoNotes\) setAutoHistory\(\[\]\);/);
  assert.match(start, /if \(change\.stopTimer\) setTimerRunning\(false\);/);
  const outside = start.replace(/if \(change\) \{[\s\S]*?\r?\n {4}\}/, "");
  assert.notEqual(outside, start, "the conditional change block exists");
  assert.doesNotMatch(outside, /setAutoHistory|setPendingChampion|setTimerRunning|setLastAuto|setSoloEnabled|setManualSide|setRestoredNotes|setPositionState/,
    "unchanged continue preserves board, staged card, notes, timer and prior solo state");
  // Only the explicit start (via the helper) and the existing draft-step checkbox can turn solo on.
  assert.equal((lab.match(/setSoloEnabled\(true\)/g) ?? []).length, 0);
  assert.equal((lab.match(/setSoloEnabled\(change\.soloEnabled\)/g) ?? []).length, 1);
  assert.match(lab, /<input type="checkbox" checked=\{soloEnabled\} disabled=\{!canSelect \|\| room\.active\} onChange=\{event => \{ setSoloEnabled\(event\.target\.checked\); setPendingChampion\(null\); setLastAuto\(null\); setAutoHistory\(\[\]\); setTimerRunning\(false\); \}\} \/>상대 자동 밴픽/,
    "draft-step checkbox unchanged");
  assert.match(lab, /<select aria-label="내 진영" value=\{manualSide\} disabled=\{!canSelect \|\| room\.active\} onChange=\{event => \{ if \(event\.target\.value === "BLUE" \|\| event\.target\.value === "RED"\) \{ setManualSide\(event\.target\.value\); setPendingChampion\(null\); setLastAuto\(null\); \} \}\}>/,
    "draft-step side select unchanged");
  // Back reflects the actual mode (choice reset to null) and changes no mode/board state.
  const back = lab.slice(lab.indexOf("function backToSetup()"), lab.indexOf("function undo()"));
  assert.match(back, /setSetupChoice\(null\)/);
  assert.doesNotMatch(back, /setSoloEnabled|setManualSide/);
  // Restore (startup, import, share, library), hash and room keep auto off and drop any pending setup choice.
  const restore = lab.slice(lab.indexOf("const restoreSession = useCallback"), lab.indexOf("}, [setPendingChampion, setInspected, setQuery]);"));
  assert.match(restore, /setSoloEnabled\(false\);[\s\S]*setSetupChoice\(null\);/);
  assert.match(lab, /const pause = \(\) => \{ setSoloEnabled\(false\); setSetupChoice\(null\); \};/);
  assert.match(lab, /if \(next\.active\) \{ restoreGeneration\.current \+= 1; setStep\("DRAFT"\); setSoloEnabled\(false\); setSetupChoice\(null\);/);
  const startup = lab.slice(lab.indexOf("readLocalDraftForRestore().then"), lab.indexOf("}, [restoreSession]);"));
  assert.doesNotMatch(startup, /setSoloEnabled\(true\)|setSetupChoice\((?!null)/, "notes restore the side only; auto stays off");
  // Nothing new is persisted: autosave/share carry no solo flag or setup choice.
  const autosave = lab.slice(lab.indexOf("const autosaveRequest = useMemo"), lab.indexOf("const retrySave"));
  assert.match(autosave, /\{ scenario: saveSnapshot, manualSide, records: prunedHistory \}/);
  assert.doesNotMatch(autosave + lab.slice(lab.indexOf("const shareSession = useMemo"), lab.indexOf("if (!timerRunning || !turn")), /soloEnabled|setupChoice|setupMode/);
  // The auto turn remains gated by the visible draft step, so nothing auto-plays while on SETUP.
  assert.match(lab, /if \(!autoChoice \|\| !boardActive \|\| pendingReset \|\| studioTab !== "DRAFT" \|\| room\.active\) return;/);
});

test("fresh SSR: setup shows the practice mode with manual selected, disabled until the session is ready", async () => {
  await withVite(async (vite) => {
    const { LocaleProvider } = await vite.ssrLoadModule("/app/locale.tsx");
    const { DraftLab } = await vite.ssrLoadModule("/app/draft-lab.tsx");
    const { ChampionNameProvider } = await vite.ssrLoadModule("/app/champion-names.tsx");
    const { sampleReport } = await vite.ssrLoadModule("/app/sample-report.ts");
    const html = renderToStaticMarkup(createElement(LocaleProvider, {}, createElement(ChampionNameProvider, null,
      createElement(DraftLab, { currentSpace: "DRAFT", report: sampleReport, feedLabel: "TEST FEED" }))));
    const setupAt = html.indexOf('class="draft-flow-setup"');
    const modeAt = html.indexOf('class="draft-flow-mode"');
    const actionsAt = html.indexOf('class="draft-flow-actions"');
    assert.ok(setupAt < modeAt && modeAt < actionsAt && actionsAt < html.indexOf('class="draft-flow-draft"'), "inside setup, above the CTA");
    const mode = html.slice(modeAt, html.indexOf("</fieldset>", modeAt));
    assert.match(html.slice(modeAt - 80, modeAt + 120), /<fieldset class="draft-flow-mode" lang="ko" disabled=""/);
    assert.match(mode, /<legend>진행 방식<\/legend>/);
    assert.equal(mode.match(/type="radio"/g)?.length, 3);
    // Attribute-order independent: parse each radio <input> tag and read its attributes individually.
    const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
    const isChecked = (tag) => /\schecked(?=[\s=/>])/.test(tag);
    const radios = [...mode.matchAll(/<input\b[^>]*>/g)].map((match) => match[0]).filter((tag) => attr(tag, "type") === "radio");
    assert.equal(radios.length, 3);
    for (const tag of radios) assert.equal(attr(tag, "name"), "draft-practice-mode", tag);
    const byValue = Object.fromEntries(radios.map((tag) => [attr(tag, "value"), tag]));
    assert.deepEqual(Object.keys(byValue).sort(), ["MANUAL", "SOLO_BLUE", "SOLO_RED"]);
    assert.equal(isChecked(byValue.MANUAL), true, "fresh default is both sides manual");
    assert.equal(isChecked(byValue.SOLO_BLUE), false, "my-blue option unchecked");
    assert.equal(isChecked(byValue.SOLO_RED), false, "my-red option unchecked");
    assert.match(mode, /블루 · 상대 자동/);
    assert.match(mode, /레드 · 상대 자동/);
  });
});

test("setup first selection: one shared guarded handler, same state as the draft-step select, no action on setup", async () => {
  const lab = await source();
  // Same guard as the existing draft-step control; prior Fearless games never lock a new set's choice.
  assert.match(lab, /const firstSideLocked = room\.active \|\| !canSelect \|\| selections\.length > 0 \|\| Boolean\(pendingChampion\);/);
  const guard = lab.match(/const firstSideLocked = [^\n]*/)[0];
  assert.doesNotMatch(guard, /games\.length/, "a new set may change the first side while Fearless locks stay");
  const handler = lab.slice(lab.indexOf("function chooseFirstPickSide("), lab.indexOf("function enterDraft()"));
  assert.match(handler, /if \(firstSideLocked\) return;/);
  assert.match(handler, /if \(side === "BLUE" \|\| side === "RED"\) \{ setFirstPickSide\(side\); if \(!seriesReport\) setSeriesReport\(structuredClone\(report\)\); \}/,
    "keeps the existing freeze-series-report semantics");
  assert.doesNotMatch(handler, /setStep|setTimerRunning|setSoloEnabled|setManualSide|setSelections|setPendingChampion|setGames|setAutoHistory|setLastAuto|setSetupChoice/,
    "choosing a side never starts, acts, clears staged work or changes mode");
  // Both selects share the state and handler; exactly two firstPickSide selects exist.
  // Line-based: the onChange arrow contains ">" so a [^>]* tag match would stop early.
  const selects = lab.match(/<select[^\n]*value=\{firstPickSide\}[^\n]*/g) ?? [];
  assert.equal(selects.length, 2);
  for (const tag of selects) {
    assert.match(tag, /disabled=\{firstSideLocked\}/);
    assert.match(tag, /onChange=\{\(event\) => chooseFirstPickSide\(event\.target\.value\)\}/);
  }
  // Setup control: separate class/label, outside the practice-mode fieldset, inside the setup step above the CTA.
  const setupStart = lab.indexOf('className="draft-flow-setup"');
  const setupOptions = lab.indexOf('className="draft-flow-options"');
  assert.ok(lab.indexOf("</fieldset>") < setupOptions && setupOptions < lab.indexOf('className="draft-flow-actions"') && setupStart < setupOptions);
  const options = lab.slice(setupOptions, lab.indexOf("</details>", setupOptions));
  assert.match(options, /<summary>경기 설정 <small className="draft-flow-options-hint">\(첫 선택 진영\)<\/small><\/summary>/);
  assert.match(options, /<label className="draft-setup-first-selection">시작할 첫 선택 진영/);
  assert.doesNotMatch(options, /draft-first-selection"|t\("draft\.firstPick"\)/, "no duplicate draft-step class or label");
  assert.doesNotMatch(lab.slice(setupOptions - 400, setupOptions), /<details[^>]*\sopen/, "collapsed by default");
  // No new persisted field: autosave/share/session signatures still carry only firstPickSide.
  assert.doesNotMatch(lab, /pendingFirst|setupFirst|firstSideChoice/);
  // The auto turn stays gated by the visible draft step (boardActive), so nothing runs from setup.
  assert.match(lab, /if \(!autoChoice \|\| !boardActive \|\| pendingReset \|\| studioTab !== "DRAFT" \|\| room\.active\) return;/);
});

test("fresh SSR: setup first selection is collapsed, BLUE by default and disabled until the session is ready", async () => {
  await withVite(async (vite) => {
    const { LocaleProvider } = await vite.ssrLoadModule("/app/locale.tsx");
    const { DraftLab } = await vite.ssrLoadModule("/app/draft-lab.tsx");
    const { ChampionNameProvider } = await vite.ssrLoadModule("/app/champion-names.tsx");
    const { sampleReport } = await vite.ssrLoadModule("/app/sample-report.ts");
    const html = renderToStaticMarkup(createElement(LocaleProvider, {}, createElement(ChampionNameProvider, null,
      createElement(DraftLab, { currentSpace: "DRAFT", report: sampleReport, feedLabel: "TEST FEED" }))));
    const optionsAt = html.indexOf('class="draft-flow-options"');
    assert.ok(optionsAt > html.indexOf('class="draft-flow-setup"') && optionsAt < html.indexOf('class="draft-flow-actions"'));
    const detailsTag = html.slice(html.lastIndexOf("<details", optionsAt), html.indexOf(">", optionsAt) + 1);
    assert.doesNotMatch(detailsTag, /\sopen/, "collapsed optional setting");
    const block = html.slice(optionsAt, html.indexOf("</details>", optionsAt));
    assert.equal(html.match(/class="draft-setup-first-selection"/g)?.length, 1);
    assert.equal(html.match(/class="draft-first-selection"/g)?.length, 1, "draft-step control unchanged and not duplicated");
    const select = block.match(/<select\b[^>]*>/)[0];
    assert.match(select, /\sdisabled=""/, "session not ready during SSR");
    assert.match(block, /<option value="BLUE" selected="">/, "fresh default BLUE first");
    assert.match(block, /시작할 첫 선택 진영/);
  });
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
