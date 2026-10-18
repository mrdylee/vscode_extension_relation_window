import { FileAnalysis, FlowExpression, Location, ReferenceRecord } from './model';
import { RelationIndex } from './relations';

type Call = Extract<FlowExpression, { kind: 'call' }>;
type Evidence = { location: Location; reason: string };
function expression(expr: FlowExpression): string {
  if (expr.kind === 'name') return expr.name;
  if (expr.kind === 'member') return expression(expr.object) + (expr.arrow ? '->' : '.') + expr.field;
  if (expr.kind === 'index') return expression(expr.object) + '[…]';
  if (expr.kind === 'cast') return expression(expr.object);
  if (expr.kind === 'address' || expr.kind === 'dereference') return (expr.kind === 'address' ? '&' : '*') + expression(expr.object);
  if (expr.kind === 'call') return expression(expr.callee) + '(…)';
  if (expr.kind === 'choice') return expr.values.map(expression).join(' | ');
  if (expr.kind === 'sequence') return expr.values.length ? expression(expr.values[expr.values.length - 1]) : 'expression';
  return 'expression';
}

// Passing a function is a separate fact from calling it. Keep ordinary refs intact.
export class FunctionArguments {
  private calls = new Map<string, ReferenceRecord>();
  private records = new Map<string, Map<string, ReferenceRecord>>();
  constructor(files: FileAnalysis[], private index: RelationIndex) {
    for (const file of files) for (const ref of file.references) {
      if (ref.kind === 'call' && ref.flowKey && ref.functionId && ref.access) this.calls.set(ref.flowKey, ref);
    }
    const names = new Set(index.symbols().filter(s => s.kind === 'function').map(s => s.name));
    const direct = (value: FlowExpression, call: Call, n: number, conditional = false) => {
      if (value.kind === 'address' || value.kind === 'cast') { direct(value.object, call, n, conditional); return; }
      if (value.kind === 'choice') { value.values.forEach(part => direct(part, call, n, true)); return; }
      if (value.kind === 'sequence') { if (value.values.length) direct(value.values[value.values.length - 1], call, n, conditional); return; }
      if (value.kind !== 'name' || (value.localId && !value.globalFallback) || !names.has(value.name)) return;
      const candidates = index.resolveReference({ id: '', name: value.name, location: value.location, kind: 'reference', conditions: [], macroIds: [] });
      const targets = candidates.filter(s => s.kind === 'function');
      const reasons = [...(conditional ? ['Conditional argument expression'] : []), ...(value.globalFallback ? ['Conditional symbol binding'] : [])];
      this.add(call, n, new Map(targets.map(s => [s.id, []])), false, conditional || !!value.globalFallback || candidates.length > 1, reasons);
    };
    const visit = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach(visit); return; }
      const node = value as Record<string, unknown>;
      if (node.kind === 'call') {
        const call = value as Call;
        if (this.calls.has(call.key)) call.args.forEach((arg, n) => direct(arg, call, n));
      }
      for (const key of Object.keys(node)) if (key !== 'location' && key !== 'type' && key !== 'path') visit(node[key]);
    };
    for (const file of files) for (const program of file.programs ?? []) visit(program.body);
  }
  add(call: Call, n: number, targets: Map<string, Evidence[]>, inferred: boolean, incomplete: boolean, reasons: string[] = []) {
    const source = this.calls.get(call.key);
    if (!source) return;
    const location = call.args[n].location, callee = expression(call.callee);
    let rows = this.records.get(source.location.uri);
    if (!rows) this.records.set(source.location.uri, rows = new Map());
    for (const [targetId, chain] of targets) {
      const target = this.index.symbol(targetId);
      if (target?.kind !== 'function') continue;
      const id = call.key.replace(/:variant:\d+:/, ':') + ':argument:' + callee + ':' + n + ':' + targetId;
      const previous = rows.get(id);
      const conditions = [...new Set([...(previous?.conditions ?? []), ...source.conditions])];
      if (previous && (!previous.argument?.inferred || inferred)) {
        previous.conditions = conditions;
        // A directly written function name remains known even if inference was partial.
        if (inferred && !previous.argument?.inferred) continue;
        if (previous.inference || incomplete) {
          const evidence = [...(previous.inference?.evidence ?? []), ...chain];
          previous.inference = { expression: expression(call.args[n]), incomplete: incomplete || !!previous.inference?.incomplete,
            reasons: [...new Set([...(previous.inference?.reasons ?? []), ...reasons])],
            evidence: evidence.filter((frame, i) => evidence.findIndex(other => other.reason === frame.reason && other.location.uri === frame.location.uri && other.location.start === frame.location.start) === i).slice(-8) };
        }
        continue;
      }
      rows.set(id, { id, name: target.name, kind: 'reference', targetId, ownerId: source.functionId, functionId: source.functionId,
        location, conditions, expansion: source.expansion,
        argument: { callee, position: n + 1, location: source.location, inferred: inferred || undefined },
        inference: inferred || incomplete ? { expression: expression(call.args[n]), evidence: chain.slice(-8), incomplete, reasons } : undefined });
    }
  }
  forFile(uri: string): ReferenceRecord[] { return [...(this.records.get(uri)?.values() ?? [])].sort((a, b) => a.location.start - b.location.start); }
}
