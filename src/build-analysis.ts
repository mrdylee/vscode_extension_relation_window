import type { createAnalyzer } from './analyzer';
import { AnalysisWorkBudget } from './analysis-budget';
import { BuildProfile, BuildFileSystem, fingerprintBuildInput, canonicalBuildUri } from './build-context';
import { FileAnalysis, fileKey } from './model';
import { preparePreprocessorContext } from './preprocessor-context';
import { AnalysisCache } from './analysis-cache';

interface PreparedUnit { unit: string; source: FileAnalysis; dependencies: Map<string, FileAnalysis | undefined>; files: FileAnalysis[] }

// Only identifiers are namespaced. Source URIs and source offsets stay navigable.
export function contextualizeFacts(file: FileAnalysis, context: NonNullable<FileAnalysis['context']>): FileAnalysis {
  const prefix = file.uri;
  function visit(value: unknown, field = ''): unknown {
    if (typeof value === 'string') return !['text', 'uri', 'body', 'name'].includes(field) && (value.startsWith(prefix + '#') || value.startsWith(prefix + '@')) ? context.key + value.slice(prefix.length) : value;
    if (Array.isArray(value)) return value.map(item => visit(item, field));
    if (!value || typeof value !== 'object') return value;
    const object = value as Record<string, unknown>, result: Record<string, unknown> = {};
    for (const [key, part] of Object.entries(object)) result[key] = visit(part, key);
    if (object.uri === file.uri && typeof object.start === 'number' && typeof object.end === 'number') result.context = context.key;
    return result;
  }
  return { ...visit(file) as FileAnalysis, context };
}
export class BuildAnalysis {
  private cache = new Map<string, PreparedUnit>();
  private disk?: AnalysisCache;
  private restored = new Map<string, { raw: FileAnalysis; derived: FileAnalysis }>();
  async setCache(directory: string, key: string) { this.disk = await AnalysisCache.open(directory, key); this.restored.clear(); }
  cachedDerived(files: FileAnalysis[]) {
    return this.disk?.matches(files.map(fileKey)) && files.every(file => this.restored.get(fileKey(file))?.raw === file)
      ? files.map(file => this.restored.get(fileKey(file))!.derived) : undefined;
  }
  async save(raw: FileAnalysis[], derived: FileAnalysis[]) {
    if (!this.disk || raw.length !== derived.length) return;
    return this.disk.save(raw.map((file, n) => ({ raw: file, derived: derived[n], skip: true, expandMacros: file.expandMacros !== false })));
  }
  async prepare(parser: Awaited<ReturnType<typeof createAnalyzer>>, files: FileAnalysis[], profile: BuildProfile, budget: AnalysisWorkBudget,
    shouldCancel?: () => boolean, eligibleHeader: (uri: string) => boolean = () => true, scopeKey = '', memoryPressure?: () => boolean): Promise<FileAnalysis[]> {
    const sources = new Map(files.map(file => [canonicalBuildUri(file.uri), file])), result: FileAnalysis[] = [], next = new Map<string, PreparedUnit>();
    const getSource=(uri:string)=>sources.get(canonicalBuildUri(uri));
    const unavailable=new Set(profile.unresolvedArtifacts?.map(uri=>canonicalBuildUri(uri)));
    const fs: BuildFileSystem = { readText: async uri => unavailable.has(canonicalBuildUri(uri))?undefined:getSource(uri)?.text, list: async () => [] };
    for (const unit of profile.units) {
      if(unit.membership!=='included')continue;
      if (shouldCancel?.()) break;
      if(memoryPressure?.())throw new Error('Build preprocessing memory budget reached; relationships are unavailable.');
      const source = getSource(unit.sourceUri); if (!source) continue;
      const signature = fingerprintBuildInput([unit.fingerprint, profile.fingerprint, scopeKey]);
      const previous = this.cache.get(unit.id);
      if (previous?.unit === signature && previous.source === source && [...previous.dependencies].every(([uri, file]) => getSource(uri) === file)) {
        result.push(...previous.files); next.set(unit.id, previous); continue;
      }
      const effective = unit.status === 'resolved' ? unit : { ...unit, macroActions: [], includeSearch: [], forcedInputs: [] };
      const prepared = await preparePreprocessorContext(effective, fs, source.text, { workBudget: budget, shouldCancel, eligibleHeader });
      if(!prepared.occurrences.length && !shouldCancel?.())throw new Error(prepared.issues.map(issue=>issue.message).join('; ') || 'No build preprocessing facts available');
      const output: FileAnalysis[] = [];
      for (const occurrence of prepared.occurrences) {
        if(occurrence.macrosOnly)continue;
        if(memoryPressure?.())throw new Error('Build preprocessing memory budget reached; relationships are unavailable.');
        const original = getSource(occurrence.uri); if (!original) continue;
        const context = { profileId: profile.id, unitId: unit.id, key: occurrence.key, configurationFingerprint: fingerprintBuildInput([profile.fingerprint, scopeKey]), prepared: occurrence };
        const restored = await this.disk?.restore(context.key, original.text, true, original.expandMacros !== false, original.analysisPolicy?.propagateCallbacks !== false);
        const compatible = restored && fingerprintBuildInput(restored.raw.context) === fingerprintBuildInput(context) &&
          fingerprintBuildInput(restored.raw.analysisPolicy) === fingerprintBuildInput(original.analysisPolicy);
        const file = compatible ? restored.raw : parser.analyze(original.uri, original.text, true, original.analysisPolicy, context);
        if (compatible) this.restored.set(context.key, restored);
        else this.restored.delete(context.key);
        file.issues = [...new Set([...file.issues, ...prepared.issues.map(issue => `Build preprocessing: ${issue.message}`)])];
        if (unit.status !== 'resolved') file.issues.push('Build options are incomplete; relationships may be incomplete.');
        if(occurrence.uri!==unit.sourceUri&&!file.symbols.length&&!file.references.length&&!file.includes.length)continue;
        output.push(file);
      }
      const entry = { unit: signature, source, dependencies: new Map(prepared.dependencies.map(d => [d.uri, getSource(d.uri)])), files: output };
      if (!shouldCancel?.() && !prepared.issues.some(i => /limit|cancelled/.test(i.code))) next.set(unit.id, entry);
      result.push(...output);
    }
    this.cache = next;
    const active=new Set(result.map(fileKey));for(const key of this.restored.keys())if(!active.has(key))this.restored.delete(key);
    return [...new Map(result.map(file => [fileKey(file), file])).values()];
  }
  clear() { this.cache.clear(); this.restored.clear(); }
}
