import { FileAnalysis } from './model';

// Show actionable limits before the UI's bounded syntax-notice list.
export function analysisNotices(files: FileAnalysis[], relative: (uri: string) => string): string[] {
  const limits: string[] = [], ordinary: string[] = [];
  for (const file of files) {
    const details = file.callbackDiagnostics ?? [];
    for (const detail of details) {
      const where = detail.location ? `${relative(detail.location.uri)}:${detail.location.line + 1}${detail.symbol ? ` · ${detail.symbol}` : ''}` : 'Project callback analysis';
      const cost = `stage=${detail.stage} · project=${detail.elapsedMs}ms · scope=${detail.scopeElapsedMs}ms · evaluations=${detail.scopeEvaluations}/${detail.evaluations}`;
      const prefix = detail.location && (detail.kind === 'time' || detail.kind === 'memory') ? `Project budget observed at ${where}` : where;
      const storage = detail.storage ? `\n  ${detail.storage.operation} · retained=${detail.storage.retained} · first omitted=${detail.storage.omitted}\n  retained sample (up to 8): ${detail.storage.sample.join(', ')}` : '';
      const costs = detail.costs?.length ? '\n  Highest propagation evaluation counts (cumulative):' + detail.costs.map(item =>
        `\n    ${item.location ? `${relative(item.location.uri)}:${item.location.line + 1} · ` : ''}${item.symbol} · runs=${item.runs} · cache hits=${item.cacheHits} · evaluations=${item.evaluations} · total=${item.elapsedMs}ms`).join('') : '';
      limits.push(`${prefix}: ${detail.message}\n  ${cost}${detail.slots === undefined ? '' : ` · slots=${detail.slots}`}${storage}${costs}`);
    }
    for (const issue of file.issues) {
      if (details.some(detail => detail.message === issue)) continue;
      const text = issue.startsWith('Callback ') ? `Project callback analysis: ${issue}` : `${relative(file.uri)}: ${issue}`;
      (/^(Callback|Macro) .*(limit|budget)/i.test(issue) ? limits : ordinary).push(text);
    }
  }
  return [...limits, ...ordinary];
}
