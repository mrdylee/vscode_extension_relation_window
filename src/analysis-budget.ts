export interface AnalysisWorkLimits { functionWork: number; projectWork: number }
export const defaultWorkLimits: AnalysisWorkLimits = { functionWork: 100_000, projectWork: 1_000_000 };
export interface AnalysisWorkUsage { macros: number; callbacks: number; total: number }
export class AnalysisWorkBudget {
  private project: AnalysisWorkUsage = {macros: 0, callbacks: 0, total: 0};
  private functions = new Map<string, AnalysisWorkUsage>();
  constructor(private limits: AnalysisWorkLimits = defaultWorkLimits, readonly progressive = false) {}
  consumeProject(units = 1, phase: 'macros' | 'callbacks' = 'macros'): 'ok' | 'project-limit' {
    this.project[phase] += units; this.project.total += units;
    return this.projectExhausted ? 'project-limit' : 'ok';
  }
  consume(id: string, units = 1, phase: 'macros' | 'callbacks' = 'callbacks'): 'ok' | 'function-limit' | 'project-limit' {
    const work = this.functions.get(id) ?? {macros: 0, callbacks: 0, total: 0};
    this.functions.set(id, work); work[phase] += units; work.total += units;
    this.project[phase] += units; this.project.total += units;
    return this.projectExhausted ? 'project-limit' : work.total > this.limits.functionWork ? 'function-limit' : 'ok';
  }
  get projectExhausted() { return !this.progressive && this.project.total > this.limits.projectWork; }
  get batches() { return Math.max(1, Math.ceil(this.project.total / this.limits.projectWork)); }
  exhausted(id: string) { return (this.functions.get(id)?.total ?? 0) > this.limits.functionWork; }
  usage(id?: string): AnalysisWorkUsage { return {...(id === undefined ? this.project : this.functions.get(id) ?? {macros: 0, callbacks: 0, total: 0})}; }
  get maximum() { return {...this.limits}; }
}
