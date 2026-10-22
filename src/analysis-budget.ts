export interface AnalysisWorkLimits { functionWork: number; projectWork: number }
export const defaultWorkLimits: AnalysisWorkLimits = { functionWork: 100_000, projectWork: 1_000_000 };
export class AnalysisWorkBudget {
  private total = 0;
  private functions = new Map<string, number>();
  constructor(private limits: AnalysisWorkLimits = defaultWorkLimits) {}
  consume(id: string, units = 1): 'ok' | 'function-limit' | 'project-limit' {
    this.total += units;
    const work = (this.functions.get(id) ?? 0) + units; this.functions.set(id, work);
    return this.total > this.limits.projectWork ? 'project-limit' : work > this.limits.functionWork ? 'function-limit' : 'ok';
  }
}
