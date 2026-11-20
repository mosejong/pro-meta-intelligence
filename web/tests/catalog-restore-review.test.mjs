import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

// No server, browser, network, generated modules or changes to application sources.
const app = fileURLToPath(new URL('../app/', import.meta.url));
const require = createRequire(import.meta.url), cache = new Map();
function moduleAt(name) {
  const filename = path.resolve(app, name.endsWith('.ts') ? name : `${name}.ts`);
  if (cache.has(filename)) return cache.get(filename).exports;
  const loadedModule = { exports: {} }; cache.set(filename, loadedModule);
  const js = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', js)(id => id.startsWith('.') ? moduleAt(path.resolve(path.dirname(filename), id)) : require(id), loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
function declaration(file, name) {
  const source = ts.createSourceFile(file, readFileSync(path.join(app, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; ts.forEachChild(node, visit); }
  visit(source); assert.ok(found, `${file}: ${name}`);
  return ts.transpileModule(found.getText(source).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
function bind(file, name, bindings) {
  return new Function(...Object.keys(bindings), `${declaration(file, name)}; return ${name};`)(...Object.values(bindings));
}
const cards = moduleAt('season-player-cards');
const compat = moduleAt('club-season-compat');
const loader = moduleAt('season-catalog-loader');
const current = JSON.parse(readFileSync(new URL('../public/history/season-player-cards.json', import.meta.url), 'utf8'));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('regression R1: pending manual catalog load cannot overwrite a practice-restored archived catalog', async () => {
  const old = structuredClone(current); old.cards = old.cards.slice(1);
  const { createHash } = await import('node:crypto');
  const canonical = x => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
  old.catalog_id = createHash('sha256').update(JSON.stringify(canonical(old.cards))).digest('hex');
  await cards.verifySeasonCardIntegrity(cards.parseSeasonCardCatalog(old));
  assert.notEqual(old.catalog_id, current.catalog_id);
  const fetchResult = deferred();
  let installed = null;
  const request = { current: null };
  const live = { current: { catalog: null, disabled: false, onCatalog: c => { installed = c; } } };
  const invalidate = bind('season-lineup-panel.tsx', 'invalidate', { request, setBusy() {} });
  const load = bind('season-lineup-panel.tsx', 'load', {
    request, live, invalidate, setBusy() {}, setMessage() {}, publicationRoot: './',
    window: { location: { href: 'https://example.invalid/' } },
    fetchJsonWithTimeout: () => fetchResult.promise,
    parseSeasonCardCatalog: cards.parseSeasonCardCatalog,
    verifySeasonCardIntegrity: cards.verifySeasonCardIntegrity,
    onCatalog: c => { installed = c; }, year: 2022, setYear() {},
  });
  const pending = load();
  // The same mounted editor receives the verified practice restore while its manual read waits.
  installed = old; live.current.catalog = old; invalidate();
  const card = old.cards[0];
  const ref = { catalog_id: old.catalog_id, card_id: card.id, player_id: card.player_id };
  assert.equal(cards.resolveSeasonRef(ref, card.role, installed).id, card.id);
  fetchResult.resolve(current); await pending;
  assert.equal(installed.catalog_id, old.catalog_id);
  assert.equal(cards.resolveSeasonRef(ref, card.role, installed).id, card.id);
});

test('all old/current card content is compared before migration, with no input mutation', () => {
  const card = current.cards[0], role = card.role;
  const old = structuredClone(current); old.catalog_id = 'a'.repeat(64);
  const club = { seasonSlots: { [role]: { catalog_id: old.catalog_id, card_id: card.id, player_id: card.player_id } } };
  const snapshot = structuredClone(club);
  assert.equal(compat.migrateClubSeasonSlots(club, old, current).seasonSlots[role].catalog_id, current.catalog_id);
  for (const edit of [c => c.player_name += 'x', c => c.game_count++, c => c.source_hashes.push('b'.repeat(64)), c => c.team_names.push('x'), c => c.patches.push('x')]) {
    const changed = structuredClone(current); edit(changed.cards[0]);
    assert.throws(() => compat.migrateClubSeasonSlots(club, old, changed));
    assert.deepEqual(club, snapshot);
  }
});

test('practice gate rejects team/roster/room transitions including change-and-return', () => {
  const make = bind('draft-practice-library.ts', 'createPracticeLoadGate', {});
  for (const [key, lock] of [['team-B', false], ['roster-B', false], ['A', true]]) {
    const gate = make(); gate.observe('A', false); const ticket = gate.ticket();
    gate.observe(key, lock); assert.notEqual(gate.check(ticket), 'OK');
    gate.observe('A', false); assert.notEqual(gate.check(ticket), 'OK');
  }
});

test('preserved loader checks integrity and respects cancellation with injected fetch only', async () => {
  let calls = 0;
  const options = { baseHref: 'https://example.invalid/', fetchImpl: async () => { calls++; return new Response(JSON.stringify(current)); } };
  const got = await loader.loadPreservedSeasonCatalogById('./', current.catalog_id, new AbortController().signal, options);
  assert.equal(got.catalog_id, current.catalog_id); assert.equal(calls, 1);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(loader.loadPreservedSeasonCatalogById('./', current.catalog_id, cancelled.signal, options), { name: 'AbortError' });
  assert.equal(calls, 1);
  const forged = structuredClone(current); forged.cards[0].player_name += 'x';
  await assert.rejects(loader.loadPreservedSeasonCatalogById('./', current.catalog_id, new AbortController().signal, { ...options, fetchImpl: async () => new Response(JSON.stringify(forged)) }));
});

test('actual practice load handler refuses late catalog after board, room or cancel changes', async () => {
  for (const change of ['team', 'roster', 'room', 'cancel', 'invalid-season', 'unchanged']) {
    const make = bind('draft-practice-library.ts', 'createPracticeLoadGate', {});
    const gate = make(); gate.observe('A', false); const ticket = gate.ticket();
    const wait = deferred(), entered = deferred(), applied = [];
    const abort = { current: null };
    const load = bind('draft-practice-library-panel.tsx', 'load', {
      locked: false, busy: false, gate: { current: gate }, begin: () => 1, current: () => true,
      setPending() {}, setStatus() {}, setBusy() {}, setSeasonLoading() {},
      library: { read: async () => ({ entry: { name: 'test' }, session: {}, roster: {}, season: { catalog_id: current.catalog_id, cutoff: current.cutoff } }) },
      loaderRef: { current: async () => { entered.resolve(); return wait.promise; } },
      seasonAbort: abort, verifySeasonPart: () => ({ ok: change !== 'invalid-season', lineups: {}, message: 'invalid' }),
      onLoadRef: { current: (...args) => applied.push(args) }, PRACTICE_GATE_TEXT: {}, SEASON_CANCELLED: 'cancelled', practiceErrorText: String,
    });
    const pending = load('test', ticket); await entered.promise;
    assert.equal(applied.length, 0);
    if (change === 'team' || change === 'roster') gate.observe(change, false);
    if (change === 'room') { gate.observe('A', true); gate.observe('A', false); }
    if (change === 'cancel') abort.current.abort();
    wait.resolve(current); await pending;
    assert.equal(applied.length, change === 'unchanged' ? 1 : 0, change);
  }
});

test('actual club confirm rechecks storage and refuses aborted or invalid restores before either apply', async () => {
  for (const change of ['storage', 'cancel', 'invalid', 'unchanged']) {
    const wait = deferred(), entered = deferred(), applied = [], job = { current: { controller: null } };
    const club = { id: 'club', name: 'saved', seasonSlots: {} }; let stored = club;
    const confirm = bind('guest-club-panel.tsx', 'confirm', {
      pending: { kind: 'LOAD', club }, disabled: false, ready: true, busy: false,
      setBusy() {}, setLoadingSaved() {}, setStatus() {}, setFailure() {}, setPending() {}, setName() {}, setHead() {}, setAssistant() {},
      window: { localStorage: { getItem: () => stored } }, CLUB_STORAGE_KEY: 'test', parseClubLibrary: value => ({ clubs: [value] }),
      seasonCatalog: current, savedSeasonCatalogId: () => 'a'.repeat(64), job, publicationRoot: './',
      loadPreservedSeasonCatalogById: async () => { entered.resolve(); return wait.promise; },
      migrateClubSeasonSlots: value => structuredClone(value),
      applyGuestClub: () => { if (change === 'invalid') throw new Error('invalid'); return {}; },
      teamId: 'blue', rosters: {}, basis: {}, index: {}, seasonLineups: {}, emptySeasonSlots: () => ({}), side: 'BLUE',
      onApply: value => applied.push(value), onSeasonApply: value => applied.push(value),
      isAbortError: e => e?.name === 'AbortError', error() {},
    });
    const pending = confirm(); await entered.promise; assert.equal(applied.length, 0);
    if (change === 'storage') stored = { ...club, name: 'changed by another tab' };
    if (change === 'cancel') job.current.controller.abort();
    wait.resolve(current); await pending;
    assert.equal(applied.length, change === 'unchanged' ? 2 : 0, change);
  }
});
