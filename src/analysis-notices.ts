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
      limits.push(`${prefix}: ${detail.message}\n  ${cost}${detail.slots === undefined ? '' : ` · slots=${detail.slots}`}`);
    }
    for (const issue of file.issues) {
      if (details.some(detail => detail.message === issue)) continue;
      const text = issue.startsWith('Callback ') ? `Project callback analysis: ${issue}` : `${relative(file.uri)}: ${issue}`;
      (/^(Callback|Macro) .*(limit|budget)/i.test(issue) ? limits : ordinary).push(text);
    }
  }
  return [...limits, ...ordinary];
}
