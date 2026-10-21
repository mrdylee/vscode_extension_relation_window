import type { Diagnostics, AnalysisPhase, RebuildReason } from '../src/diagnostics';
import type { ViewState } from '../src/view-state';

const phaseNames: Record<AnalysisPhase | 'idle', string> = {
  sources: 'Source parsing', macros: 'Macro expansion', callbacks: 'Callback resolution', transfer: 'Result transfer', idle: 'Idle'
};
const mib = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MiB`;
const time = (at: number) => new Date(at).toLocaleTimeString('en-GB', { hour12: false });
const rebuildNames: Record<RebuildReason, string> = { startup: 'Extension startup', configuration: 'Analysis settings changed',
  'workspace-folders': 'Workspace folders changed', command: 'Rebuild command', toolbar: 'Rebuild button' };
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}

export function createDiagnostics(version: string, refresh: () => void, reportIssue: () => void) {
  const dialog = el('dialog', '', 'memory-diagnostics');
  dialog.setAttribute('aria-label', 'Memory diagnostics');
  const header = el('div', '', 'diagnostics-heading');
  header.append(el('strong', `Dynsight v${version} · Diagnostics`));
  const report = el('button', 'Report issue'), refreshButton = el('button', 'Refresh'), close = el('button', 'Close');
  report.type = refreshButton.type = close.type = 'button';
  report.title = 'Prepare a local report to review before sharing on GitHub';
  report.onclick = reportIssue;
  refreshButton.onclick = refresh; close.onclick = () => dialog.close();
  header.append(report, refreshButton, close);
  const body = el('div'); dialog.append(header, body); document.body.append(dialog);
  let data: Diagnostics | undefined, state: ViewState | undefined, lastIncident = '';
  function render() {
    const historyOpen = body.querySelector('details')?.open ?? false;
    body.replaceChildren();
    if (!data) { body.append(el('p', 'Waiting for analysis measurements…')); return; }
    const worker = data.worker;
    body.append(el('div', data.environment + (data.index ? ` · Session started: ${time(data.index.sessionStartedAt)}` : ''), 'muted'));
    body.append(el('div', data.workerError ? `Worker stopped: ${data.workerError}` : state?.status ?? 'Preparing C index…', 'diagnostics-status'));
    body.append(el('div', `${state?.mode ?? 'references'} · ${state?.graph?.root.name ?? 'No symbol selected'} · ${state?.fileCount ?? 0} indexed files`, 'diagnostics-selection'));
    if (data.index) {
      const index = data.index;
      if (index.cache) body.append(el('div', `Disk cache: ${index.cache.state} · Restored: ${index.cache.restored} files · Saved: ${index.cache.saved} files`));
      const latest = index.rebuilds.at(-1);
      const trigger = (record: typeof latest) => record ? `${rebuildNames[record.reason]}${record.settings?.length ? ` (${record.settings.join(', ')})` : ''}` : '';
      if (latest) body.append(el('div', `Last rebuild: #${latest.number} · ${time(latest.at)} · ${trigger(latest)} · ${latest.outcome}`));
      const fileCounts = (record: typeof latest, showDiscovery = true) => {
        const files = record?.files;
        return files ? `Search results: ${files.searchResults} · Selected: ${files.selected} · Indexed: ${files.indexed ?? '—'} · Failed: ${files.failed ?? '—'} · Unaccounted: ${files.missing ?? '—'}${showDiscovery || !files.discoveryComplete ? ` · Discovery: ${files.discoveryComplete ? 'finished' : 'unfinished'}` : ''}` : 'File counts unavailable';
      };
      if (latest?.files) {
        body.append(el('div', fileCounts(latest, false), `diagnostics-file-counts${latest.files.failed || latest.files.missing ? ' warning' : ''}`));
      }
      const history = el('details'); history.open = historyOpen;
      history.append(el('summary', 'Rebuild history and source activity'));
      const table = el('table'), heading = el('tr');
      ['Recent rebuilds', 'Trigger', 'Result'].forEach(label => heading.append(el('th', label))); table.append(heading);
      for (const record of [...index.rebuilds].reverse()) {
        const row = el('tr');
        row.append(el('td', `#${record.number} · ${time(record.at)}`),
          el('td', trigger(record)),
          el('td', `${record.outcome}${record.finishedAt === undefined ? '' : ` · ${((record.finishedAt - record.at) / 1000).toFixed(1)}s`}${record.files ? '\n' + fileCounts(record) : ''}`));
        table.append(row);
      }
      history.append(table, el('div', `Rebuilds: ${index.rebuildCount} · Source parses: ${index.sourceParses} · Relation passes: ${index.relationPasses} (this session)`));
      if (latest?.files) history.append(el('div', 'Search results may include duplicates/non-C files. Selected is unique C/H files within the limit. Indexed/Failed/Unaccounted are selected-file snapshots at rebuild end; unfinished runs may have no results. Discovery is unfinished on errors or file limits. These counts cannot prove search found every file.', 'diagnostics-note muted'));
      if (index.lastSourceEvent) history.append(el('div', `Last source event: ${index.lastSourceEvent.kind} · ${time(index.lastSourceEvent.at)} (may reuse unchanged source)`, 'muted'));
      body.append(history);
    }
    if (data.copilot) {
      const ai = data.copilot;
      body.append(el('div', `Copilot callbacks: ${ai.state} · Processed: ${ai.completed ?? 0}/${ai.total ?? 0} · Requests this session: ${ai.requests} · Cache hits: ${ai.cacheHits} · Remaining (includes failed): ${ai.remaining} · Failures: ${ai.failures}`));
      body.append(el('div', `AI candidates: ${ai.candidates} · No candidate in supplied context: ${ai.notFound} · Context limited: ${ai.contextLimited}`));
      body.append(el('div', 'Coverage is limited to detected callback sites in the saved index, not proof of all runtime targets. Use Analyze next 5 to process remaining sites; normal Rebuild preserves valid AI results.', 'diagnostics-note muted'));
    }
    if (worker) {
      const sample = worker.sample, cards = el('div', '', 'diagnostics-metrics');
      function metric(label: string, value: string, warning = false) {
        const card = el('div'); card.append(el('span', label), el('strong', value, warning ? 'warning' : '')); cards.append(card);
      }
      metric('Worker JS used / limit', `${mib(sample.heapUsed)} / ${mib(sample.heapLimit)}`);
      metric('Analysis guard (60% of JS limit)', mib(sample.heapLimit * 0.6), !!worker.firstLimit);
      metric('Worker sampled JS peak', mib(worker.peakHeap));
      metric('Worker external memory (separate)', mib(sample.external));
      body.append(cards);
      body.append(el('div', `Last Worker sample: ${time(sample.at)} · ${phaseNames[worker.phase]} · Run ${worker.run}`, 'muted'));
      const table = el('table');
      const heading = el('tr'); ['Latest stage checkpoints', 'Before', 'After'].forEach(label => heading.append(el('th', label))); table.append(heading);
      for (const phase of ['sources', 'macros', 'callbacks', 'transfer'] as const) {
        const checkpoint = worker.phases[phase], row = el('tr');
        row.append(el('td', phaseNames[phase]), el('td', checkpoint ? mib(checkpoint.before.heapUsed) : '—'),
          el('td', checkpoint?.after ? mib(checkpoint.after.heapUsed) : worker.phase === phase ? 'In progress' : '—'));
        table.append(row);
      }
      body.append(table);
      const hit = worker.firstLimit;
      body.append(el('div', hit ? `First budget hit: ${phaseNames[hit.phase]} · ${mib(hit.sample.heapUsed)} / guard ${mib(hit.sample.heapLimit * 0.6)} · ${time(hit.sample.at)}`
        : 'First budget hit: none recorded in this rebuild', hit ? 'diagnostics-incident warning' : 'diagnostics-incident'));
      const counts = worker.counts;
      body.append(el('div', `Worker inputs: ${counts.files.toLocaleString('en-US')} files · ${(counts.sourceChars / 1e6).toFixed(2)} M source characters · ${counts.macroFiles.toLocaleString('en-US')} macro-enabled files`));
      body.append(el('div', `Raw references: ${counts.references.toLocaleString('en-US')} · Flow programs: ${counts.programs.toLocaleString('en-US')}`));
    } else body.append(el('p', 'Worker sample not received yet.'));
    body.append(el('div', `Extension host JS (shared): ${mib(data.host.heapUsed)} · sampled ${time(data.host.at)}`, 'diagnostics-host'));
    (body.querySelector('details') ?? body).append(el('div', 'MiB = 1,048,576 bytes. Samples include caches and garbage collection; they are not total system RAM or exact stage allocations. Refresh waits for a busy Worker.', 'diagnostics-note muted'));
  }
  function show() { render(); if (!dialog.open) dialog.showModal(); }
  return {
    open() { show(); refresh(); },
    update(next: Diagnostics | undefined, nextState?: ViewState) {
      data = next; if (nextState) state = nextState;
      const hit = data?.worker?.firstLimit;
      const incident = data?.workerError ? `${data.worker?.run}:error:${data.workerError}` : hit ? `${data?.worker?.run}:${hit.sample.at}`
        : state?.status.includes('memory budget') ? `${data?.worker?.run}:partial` : '';
      if (incident && incident !== lastIncident) { lastIncident = incident; show(); }
      else if (dialog.open) render();
    }
  };
}
