import type { Diagnostics, AnalysisPhase } from '../src/diagnostics';
import type { ViewState } from '../src/view-state';

const phaseNames: Record<AnalysisPhase | 'idle', string> = {
  sources: 'Source parsing', macros: 'Macro expansion', callbacks: 'Callback resolution', transfer: 'Result transfer', idle: 'Idle'
};
const mib = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MiB`;
const time = (at: number) => new Date(at).toLocaleTimeString('en-GB', { hour12: false });
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}

export function createDiagnostics(version: string, refresh: () => void, reportIssue: () => void) {
  const dialog = el('dialog', '', 'memory-diagnostics');
  dialog.setAttribute('aria-label', 'Memory diagnostics');
  const header = el('div', '', 'diagnostics-heading');
  header.append(el('strong', `C Relations v${version} · Diagnostics`));
  const report = el('button', 'Report issue'), refreshButton = el('button', 'Refresh'), close = el('button', 'Close');
  report.type = refreshButton.type = close.type = 'button';
  report.title = 'Prepare a local report to review before sharing on GitHub';
  report.onclick = reportIssue;
  refreshButton.onclick = refresh; close.onclick = () => dialog.close();
  header.append(report, refreshButton, close);
  const body = el('div'); dialog.append(header, body); document.body.append(dialog);
  let data: Diagnostics | undefined, state: ViewState | undefined, lastIncident = '';
  function render() {
    body.replaceChildren();
    if (!data) { body.append(el('p', 'Waiting for analysis measurements…')); return; }
    const worker = data.worker;
    body.append(el('div', data.environment, 'muted'));
    body.append(el('div', data.workerError ? `Worker stopped: ${data.workerError}` : state?.status ?? 'Preparing C index…', 'diagnostics-status'));
    body.append(el('div', `${state?.mode ?? 'references'} · ${state?.graph?.root.name ?? 'No symbol selected'} · ${state?.fileCount ?? 0} indexed files`, 'diagnostics-selection'));
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
    body.append(el('div', 'MiB = 1,048,576 bytes. Samples include caches and garbage collection; they are not total system RAM or exact stage allocations. Refresh waits for a busy Worker.', 'diagnostics-note muted'));
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
