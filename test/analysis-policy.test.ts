import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analysisConfiguration, resolveAnalysisPolicy, smartAnalysisScope } from '../src/analysis-policy';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(process.cwd() + '/package.json');
const picker = buildSync({ entryPoints: ['src/macro-folders.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['vscode'] }).outputFiles[0].text;
for (const mode of ['all', 'none', 'cancel', 'multi-root']) test(`Smart Analysis picker preserves explicit paths and save target (${mode})`, async () => {
  const writes: { key: string; value: string[]; target: number; root: string }[] = [];
  const folders = [{ uri: 'one', name: 'One' }, ...(mode === 'multi-root' ? [{ uri: 'two', name: 'Two' }] : [])];
  const vscode = { ConfigurationTarget: { Workspace: 2, WorkspaceFolder: 3 }, workspace: { workspaceFolders: folders,
    getConfiguration: (_section: string, root: string) => ({ get: (key: string, fallback: unknown) => key === 'include' ? ['App/**', 'SDK/**'] : fallback,
      inspect: () => undefined, update: async (key: string, value: string[], target: number) => { writes.push({ key, value, target, root }); } }) },
    window: { showWorkspaceFolderPick: async () => folders[1], showQuickPick: async (choices: unknown[]) => mode === 'cancel' ? undefined : mode === 'none' ? [] : choices } };
  const module = { exports: {} as any };
  runInNewContext(picker, { module, exports: module.exports, process, require: (key: string) => key === 'vscode' ? vscode : require(key) });
  await module.exports.selectDetailedAnalysisFolders();
  if (mode === 'cancel') assert.equal(writes.length, 0);
  else {
    assert.equal(writes[0].key, 'smartAnalysis.include');
    assert.deepEqual(Array.from(writes[0].value), mode === 'none' ? [] : ['App/**', 'SDK/**']);
    assert.equal(writes[0].target, mode === 'multi-root' ? 3 : 2);
    assert.equal(writes[0].root, mode === 'multi-root' ? 'two' : 'one');
  }
});

test('explicit empty detailed folders overrides legacy all-on', () => {
  assert.deepEqual(resolveAnalysisPolicy('App/main.c', [], { macroFolders: ['**'], analyzeCallbacks: true }, false),
    { expandMacros: false, propagateCallbacks: false });
});
test('one folder controls both expensive stages without widening the rest', () => {
  assert.deepEqual(resolveAnalysisPolicy('App/main.c', ['App/**'], undefined, false), { expandMacros: true, propagateCallbacks: true });
  assert.deepEqual(resolveAnalysisPolicy('SDK/main.c', ['App/**'], undefined, false), { expandMacros: false, propagateCallbacks: false });
});
test('legacy macro and callback scope remain independent until explicitly migrated', () => {
  assert.deepEqual(resolveAnalysisPolicy('SDK/main.c', undefined, { macroFolders: ['App/**'], analyzeCallbacks: true }, false),
    { expandMacros: false, propagateCallbacks: true });
  assert.deepEqual(resolveAnalysisPolicy('App/main.c', undefined, undefined, false), { expandMacros: false, propagateCallbacks: false });
});
test('Windows slashes and case are normalized only when requested', () => {
  assert.equal(resolveAnalysisPolicy('APP\\main.c', ['App/**'], undefined, true).propagateCallbacks, true);
  assert.equal(resolveAnalysisPolicy('APP/main.c', ['App/**'], undefined, false).propagateCallbacks, false);
});
test('Smart Analysis exclusions and Macro switch control both local stages', () => {
  assert.deepEqual(resolveAnalysisPolicy('App/generated/main.c', ['App/**'], undefined, false, ['App/generated/**']),
    { expandMacros: false, propagateCallbacks: false });
  assert.deepEqual(resolveAnalysisPolicy('App/main.c', ['App/**'], undefined, false, [], false),
    { expandMacros: false, propagateCallbacks: false });
});
test('shared scope prefers explicit new include, including empty, and otherwise preserves saved detailed folders', () => {
  const values = new Map<string, unknown>([['detailedAnalysisFolders', ['Old/**']]]);
  const config = { get: <T>(key: string, fallback: T) => (values.get(key) ?? fallback) as T,
    inspect: (key: string) => ({ workspaceValue: values.get(key) }) };
  assert.deepEqual(smartAnalysisScope(config), { include: ['Old/**'], exclude: [], unified: false });
  values.set('smartAnalysis.include', []); values.set('smartAnalysis.exclude', ['Generated/**']);
  assert.deepEqual(smartAnalysisScope(config), { include: [], exclude: ['Generated/**'], unified: true });
});
test('hidden legacy settings are read in place across the old namespace without losing false or empty overrides', () => {
  const config = (values: Record<string,unknown>) => ({ get:<T>(key:string,fallback:T)=>(values[key]??fallback) as T,
    inspect:(key:string)=>({workspaceValue:values[key]}) });
  const previous=config({analyzeCallbacks:true,macroExpansionFolders:['Old/**'],copilotInclude:['Old/**'],include:['Old/**']});
  const current=config({analyzeCallbacks:false,copilotInclude:[],include:['New/**']});
  const merged=analysisConfiguration(current,previous);
  assert.equal(merged.get('analyzeCallbacks',true),false);
  assert.deepEqual(merged.get('macroExpansionFolders',[]),['Old/**']);
  assert.deepEqual(merged.get('copilotInclude',['**']),[]);
  assert.deepEqual(merged.get('include',[]),['New/**']);
});
test('legacy workspace AI exclusion still overrides a current-namespace global scope', () => {
  const current={get:<T>(_key:string,fallback:T)=>fallback,inspect:()=>({globalValue:['**']})};
  const previous={get:<T>(_key:string,fallback:T)=>fallback,inspect:()=>({workspaceValue:[]})};
  assert.deepEqual(analysisConfiguration(current,previous).get('copilotInclude',['**']),[]);
});
