import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createAnalyzer } from '../src/analyzer';
import { RelationIndex } from '../src/relations';
import { applyCallbackHints } from '../src/copilot-relations';
import { CallbackHint } from '../src/copilot-callbacks';
import { FileAnalysis, ReferenceRecord, SymbolRecord } from '../src/model';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(path.resolve('package.json'));
const viewBundle = buildSync({entryPoints:['src/view.ts'], bundle:true, write:false, platform:'node', format:'cjs', external:['vscode']}).outputFiles[0].text;

for (const mode of ['callees', 'both']) test(`AI candidate navigation previews its cross-file definition and expands its real callees (${mode})`, async () => {
  const parser = await createAnalyzer(path.resolve('node_modules/web-tree-sitter/web-tree-sitter.wasm'), path.resolve('node_modules/tree-sitter-c/tree-sitter-c.wasm'));
  const caller = parser.analyze('file:///caller.c', 'void run(void(*cb)(void)){cb();}');
  const implementation = parser.analyze('file:///impl.c', 'void leaf(void){}\nvoid target(void){leaf();}');
  const index = new RelationIndex(); index.update(caller); index.update(implementation);
  const target = implementation.symbols.find(symbol => symbol.name === 'target')!;
  const root = caller.symbols.find(symbol => symbol.name === 'run')!;
  const site = caller.references.find(ref => ref.kind === 'call')!;
  applyCallbackHints(index, [{key:'navigation', callsite:site.location, expression:'cb', status:'candidates', cached:true,
    candidates:[{targetId:target.id, evidence:[target.location], reason:'Source registration'}]}]);
  class Emitter {
    event = () => ({dispose() {}});
    fire() {} dispose() {}
  }
  const opened: any[] = [];
  const vscode = {EventEmitter:Emitter, Uri:{parse:(uri:string) => ({path:new URL(uri).pathname, toString:() => uri})},
    Range:class {start:any;end:any;constructor(line:number,column:number,endLine:number,endColumn:number) {
      this.start={line,character:column};this.end={line:endLine,character:endColumn};
    }}, ViewColumn:{One:1},
    workspace:{getConfiguration:() => ({get:(_key:string, fallback:unknown) => fallback}),
      onDidChangeConfiguration:() => ({dispose(){}}), asRelativePath:(uri:any) => uri.path},
    window:{showTextDocument:async (uri:any, options:any) => {opened.push({uri:uri.toString(),options});}}};
  const module = {exports:{} as any};
  runInNewContext(viewBundle, {module, exports:module.exports, process, Buffer, URL, setTimeout, clearTimeout,
    require:(name:string) => name === 'vscode' ? vscode : require(name)});
  const view = new module.exports.RelationView({index, changed:new Emitter(), diagnosticsChanged:new Emitter(),
    failures:new Map(), skipInactive:true, status:'Index ready'}, {});
  try {
    view.state.mode = mode; view.setRoot(root);
    const node = view.state.graph.root.children.find((node:any) => node.name === 'target');
    assert.equal(node.callKind, 'ai-candidate');
    await view.handleMessage({type:'selectNode', key:node.key});
    assert.equal(view.state.context.location.uri, implementation.uri);
    assert.equal(view.state.context.location.start, target.location.start);
    assert.equal(view.state.graph.root.children.find((node:any) => node.name === 'target').children[0].name, 'leaf');
    await view.handleMessage({type:'open', id:target.id});
    assert.equal(opened.at(-1).uri, implementation.uri);
    assert.equal(opened.at(-1).options.selection.start.line, target.location.line);
    await view.handleMessage({type:'preview', id:node.sites[0].id});
    assert.equal(view.state.context.location.uri, caller.uri, 'original callback callsite remains separately navigable');
    assert.equal(view.state.context.location.start, site.location.start);
    assert.equal(index.callbackAt(caller.uri, site.location.start)?.incomplete, true, 'navigation must not turn an AI suggestion into a proven call');
  } finally { view.dispose(); }
});

function synthetic(refCount: number) {
  const uri = 'file:///large.c';
  const location = { uri, start: 0, end: 4, line: 0, column: 0, endLine: 0, endColumn: 4 };
  const target: SymbolRecord = { id: uri + '#target', name: 'target', kind: 'function', location, extent: location, definition: true, storage: 'static', conditions: [], pointer: false };
  const references: ReferenceRecord[] = Array.from({ length: refCount }, (_, n) => ({ id: uri + '@' + n, name: 'cb' + n, kind: 'call', access: 'read',
    location: { ...location, start: 10 + n * 10, end: 14 + n * 10 }, ownerId: target.id, functionId: target.id, indirect: true, conditions: [] }));
  const file: FileAnalysis = { uri, text: '', symbols: [target], references, includes: [], issues: [] };
  const hint = (site: ReferenceRecord): CallbackHint => ({ key: site.id, callsite: site.location, expression: site.name, status: 'candidates', cached: true,
    candidates: [{ targetId: target.id, evidence: [target.location], reason: 'Source registration' }] });
  return { file, hint, target };
}

test('AI candidates retain source evidence and appear in both directions without replacing unresolved calls', async () => {
  const parser = await createAnalyzer(path.resolve('node_modules/web-tree-sitter/web-tree-sitter.wasm'), path.resolve('node_modules/tree-sitter-c/tree-sitter-c.wasm'));
  const file = parser.analyze('file:///candidate.c', 'typedef void(*CB)(void); void target(void){} void run(CB cb){cb();}', true);
  const index = new RelationIndex(); index.update(file);
  const target = file.symbols.find(s => s.name === 'target')!;
  const run = file.symbols.find(s => s.name === 'run')!;
  const site = file.references.find(ref => ref.kind === 'call' && ref.name === 'cb')!;
  applyCallbackHints(index, [{ key: 'test', callsite: site.location, expression: 'cb', status: 'candidates', cached: false,
    candidates: [{ targetId: target.id, evidence: [target.location], reason: 'Registered candidate' }] }]);
  const outgoing = index.relations(run.id, 'callees');
  assert.ok(outgoing.some(group => group.name === 'cb'), 'unresolved evidence remains');
  const candidate = outgoing.find(group => group.name === 'target')!;
  assert.equal(candidate.callKind, 'ai-candidate');
  assert.equal(candidate.sites[0].ambiguous, true);
  assert.equal(index.relations(target.id, 'callers')[0].name, 'run');
  assert.equal(index.callbackAt(file.uri, site.location.start)?.incomplete, true);
  applyCallbackHints(index, []);
  assert.equal(index.relations(target.id, 'callers').length, 0);
  index.update({ ...file, references: [...file.references, { ...site, name: target.name, targetId: target.id, indirect: false, callKind: 'inferred' }] });
  applyCallbackHints(index, [{ key: 'same', callsite: site.location, expression: 'cb', status: 'candidates', cached: false,
    candidates: [{ targetId: target.id, evidence: [target.location], reason: 'Duplicate candidate' }] }]);
  assert.equal(index.relations(target.id, 'callers')[0].sites.length, 1, 'AI does not duplicate an already resolved static call');
  assert.equal(index.files.get(file.uri)!.references.some(ref => ref.callKind === 'ai-candidate'), false);
});

test('many cached hints inspect reference locations once rather than scanning the file per hint', () => {
  const { file, hint } = synthetic(10_000), hints = file.references.slice(-200).map(hint);
  let locationReads = 0;
  file.references = file.references.map(ref => new Proxy(ref, { get(target, key, receiver) {
    if (key === 'location') locationReads++;
    return Reflect.get(target, key, receiver);
  } }));
  const index = new RelationIndex(); index.update(file); locationReads = 0;
  applyCallbackHints(index, hints);
  assert.equal(index.files.get(file.uri)!.references.filter(ref => ref.callKind === 'ai-candidate').length, 200);
  assert.ok(locationReads < 40_000, `Expected linear source lookup, observed ${locationReads} reference-location reads`);
  assert.equal(file.references.length, 10_000, 'source reference array remains unchanged');
});

test('empty results preserve unchanged files without allocating filtered reference arrays', () => {
  const { file, hint } = synthetic(20);
  let filters = 0;
  file.references = new Proxy(Object.freeze(file.references) as ReferenceRecord[], { get(target, key, receiver) {
    if (key === 'filter') filters++;
    return Reflect.get(target, key, receiver);
  } });
  const index = new RelationIndex(); index.update(file);
  applyCallbackHints(index, []);
  const empty = { ...hint(file.references[0]), status: 'not-found' as const, candidates: [] };
  applyCallbackHints(index, [empty]);
  assert.equal(index.files.get(file.uri), file);
  assert.equal(filters, 0);
});

test('lookup preserves first callable site, static deduplication and incoming hint evidence', () => {
  const { file, hint, target } = synthetic(3);
  const first = file.references[0], second = file.references[1], third = file.references[2];
  file.references.unshift({ ...first, id: 'unevaluated', access: undefined });
  file.references.push({ ...first, id: 'later-at-same-location', name: 'later' });
  file.references.push({ ...second, id: 'existing-target', name: target.name, kind: 'reference', targetId: target.id });
  const index = new RelationIndex(); index.update(file);
  const firstHint = hint(first), repeat = { ...hint(third), expression: 'repeated source', candidates: [{ ...hint(third).candidates[0], reason: 'Second evidence' }] };
  applyCallbackHints(index, [firstHint, hint(second), hint(third), repeat]);
  const candidates = index.files.get(file.uri)!.references.filter(ref => ref.callKind === 'ai-candidate');
  assert.deepEqual(candidates.map(ref => ref.id), [`${first.id}:ai:${target.id}`, `${third.id}:ai:${target.id}`, `${third.id}:ai:${target.id}`]);
  assert.deepEqual(candidates.map(ref => ref.inference!.evidence[0].reason), ['Source registration', 'Source registration', 'Second evidence']);
  assert.equal(file.references.some(ref => ref.callKind === 'ai-candidate'), false);
});
