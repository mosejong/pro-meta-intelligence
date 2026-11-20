import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

// Runs the real `invalidate` + `load` declarations from SeasonLineupPanel against shared refs.
// React is not mounted: the layout-effect cleanup `[catalog, disabled]` (and unmount) is modelled by
// calling `invalidate()` and then updating `live.current`, exactly what the committed effects do.
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
const source = ts.createSourceFile('season-lineup-panel.tsx', readFileSync(path.join(app, 'season-lineup-panel.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name) {
  let found;
  (function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; ts.forEachChild(node, visit); })(source);
  assert.ok(found, name);
  return ts.transpileModule(found.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}

const cards = moduleAt('season-player-cards');
const current = JSON.parse(readFileSync(new URL('../public/history/season-player-cards.json', import.meta.url), 'utf8'));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function panel(fetchImpl) {
  const state = { busy: false, message: '', installed: [], year: 2022 };
  const live = { current: { catalog: null, disabled: false, onCatalog: c => state.installed.push(['first', c]) } };
  const bindings = {
    request: { current: null }, live, publicationRoot: './', window: { location: { href: 'https://example.invalid/' } },
    setBusy: v => { state.busy = v; }, setMessage: v => { state.message = v; }, setYear: f => { state.year = typeof f === 'function' ? f(state.year) : f; },
    fetchJsonWithTimeout: fetchImpl, parseSeasonCardCatalog: cards.parseSeasonCardCatalog, verifySeasonCardIntegrity: cards.verifySeasonCardIntegrity,
  };
  const { invalidate, load } = new Function(...Object.keys(bindings), `${declaration('invalidate')}\n${declaration('load')}\nreturn { invalidate, load };`)(...Object.values(bindings));
  // Simulated commit of new props: layout cleanup for [catalog, disabled] runs, then live refs update.
  const commit = next => { if (next.catalog !== live.current.catalog || next.disabled !== live.current.disabled) invalidate(); live.current = { ...live.current, ...next }; };
  return { state, live, load, invalidate, commit };
}
const archived = () => { const old = structuredClone(current); old.catalog_id = 'a'.repeat(64); return old; };

test('external restore while a manual read is pending: no onCatalog, busy cleared', async () => {
  const wait = deferred(); const p = panel(() => wait.promise);
  const pending = p.load(); assert.equal(p.state.busy, true);
  const old = archived(); p.commit({ catalog: old });
  assert.equal(p.state.busy, false);
  wait.resolve(current); await pending;
  assert.deepEqual(p.state.installed, []); assert.equal(p.live.current.catalog, old); assert.equal(p.state.busy, false);
});

test('disabled transition and unmount invalidate the pending read', async () => {
  for (const kind of ['disabled', 'unmount']) {
    const wait = deferred(); const p = panel(() => wait.promise);
    const pending = p.load();
    if (kind === 'disabled') p.commit({ disabled: true }); else p.invalidate();
    wait.resolve(current); await pending;
    assert.deepEqual(p.state.installed, [], kind); assert.equal(p.state.busy, false, kind);
  }
});

test('own successful read applies via the latest onCatalog, not the closure at start', async () => {
  const wait = deferred(); const p = panel(() => wait.promise);
  const pending = p.load();
  p.live.current = { ...p.live.current, onCatalog: c => p.state.installed.push(['latest', c]) };
  wait.resolve(current); await pending;
  assert.equal(p.state.installed.length, 1); assert.equal(p.state.installed[0][0], 'latest');
  assert.equal(p.state.installed[0][1].catalog_id, current.catalog_id); assert.equal(p.state.busy, false);
  p.commit({ catalog: p.state.installed[0][1] }); // its own catalog commit finds nothing pending
  assert.equal(p.state.busy, false);
});

test('failure then retry still works; an older superseded response is ignored', async () => {
  const waits = [deferred(), deferred()]; let n = 0; const p = panel(() => waits[n++].promise);
  const first = p.load(); waits[0].reject(new Error('network')); await first;
  assert.equal(p.state.busy, false); assert.match(p.state.message, /불러오지 못했습니다/); assert.deepEqual(p.state.installed, []);
  const retry = p.load(); waits[1].resolve(current); await retry;
  assert.equal(p.state.installed.length, 1); assert.equal(p.state.busy, false); assert.equal(p.state.message, '');
  const w = [deferred(), deferred()]; let m = 0; const q = panel(() => w[m++].promise);
  const a = q.load(), b = q.load();
  w[0].resolve(current); await a; assert.deepEqual(q.state.installed, []); assert.equal(q.state.busy, true);
  w[1].resolve(current); await b; assert.equal(q.state.installed.length, 1); assert.equal(q.state.busy, false);
});
