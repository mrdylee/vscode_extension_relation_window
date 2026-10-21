import type { Access, GraphNode, Kind } from '../src/model';
import type { ViewState } from '../src/view-state';
import { highlightC } from '../src/syntax';
import { createDiagnostics } from './diagnostics';
declare const __EXTENSION_VERSION__: string;
declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const api = acquireVsCodeApi();
const send = (type: string, rest = {}) => api.postMessage({ type, ...rest });
const app = document.getElementById('app')!;
const contextOnly = document.body.dataset.view === 'context';
const diagnostics = contextOnly ? undefined : createDiagnostics(__EXTENSION_VERSION__, () => send('diagnostics'), () => send('reportIssue'));
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
}
function button(text: string, action: (event: MouseEvent) => void, title = text) {
  const node = el('button', '', text); node.type = 'button'; node.title = title; node.onclick = action; return node;
}
const toolbar = el('header', 'toolbar');
const panes = el('main', 'panes');
const context = el('section', 'context pane');
const relation = el('section', 'relation pane');
const graph = el('div', 'graph');
// Expansion can move/recreate nodes between clicks; keep the first click's source target.
let firstClickId: string | undefined;
graph.addEventListener('click', event => {
  if (event.detail === 1) firstClickId = (event.target as HTMLElement).closest<HTMLElement>('.node-title')?.dataset.preview;
}, true);
graph.addEventListener('dblclick', event => {
  if (firstClickId) { event.preventDefault(); send('open', { id: firstClickId }); }
});
const graphHeader = el('div', 'pane-heading');
const candidates = el('div', 'candidates');
const footer = el('footer');
const divider = el('div', 'divider'); divider.tabIndex = 0;
divider.setAttribute('role', 'separator'); divider.setAttribute('aria-label', 'Context width'); divider.setAttribute('aria-orientation', 'vertical');
let split = 42;
function resize(value: number) { split = Math.max(20, Math.min(75, value)); panes.style.setProperty('--split', `${split}%`); divider.setAttribute('aria-valuenow', String(Math.round(split))); }
resize(split);
divider.onpointerdown = event => { divider.setPointerCapture(event.pointerId); };
divider.onpointermove = event => { if (divider.hasPointerCapture(event.pointerId)) resize((event.clientX - panes.getBoundingClientRect().left) / panes.clientWidth * 100); };
divider.onpointerup = event => divider.releasePointerCapture(event.pointerId);
divider.onkeydown = event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); resize(split + (event.key === 'ArrowLeft' ? -3 : 3)); } };
relation.append(graphHeader, candidates, graph);
panes.append(context, divider, relation);
if (contextOnly) app.append(context); else app.append(toolbar, panes, footer);
let signature: string | undefined = '', previewSignature: string | undefined = '';
let rootKey: string | undefined;
let currentDirection: ViewState['callGraphDirection'] | undefined;
let panX = 0, panY = 0;
function positionGraph() {
  const canvas = graph.firstElementChild as HTMLElement | null;
  if (canvas) canvas.style.transform = `translate(${panX}px, ${panY}px)`;
}
function resetGraphPosition() {
  panX = panY = 0; positionGraph(); graph.scrollLeft = graph.scrollTop = 0;
}
const icons: Record<Kind, string> = { function: 'ƒ', variable: 'v', type: 'T', macro: '#', unknown: '?' };
const kindNames: Record<Kind, string> = { function: 'Function', variable: 'Variable', type: 'Type', macro: 'Macro', unknown: 'Unknown' };
const accessNames: Record<Access, string> = { read: 'R · Read', write: 'W · Write', readwrite: 'RW · Read/write', address: '& · Address passed' };
function accessBadge(access: Access, compact = false) {
  const badge = el('span', 'access-badge', compact ? accessNames[access].split(' · ')[0] : accessNames[access]);
  badge.dataset.access = access;
  return badge;
}
function kindLabel(node: GraphNode) {
  if (node.containerName) return `Member of ${node.containerName}`;
  return node.kind === 'function' && node.definition !== undefined
    ? `Function ${node.definition ? 'definition' : 'declaration'}` : kindNames[node.kind];
}
function icon(node: GraphNode) {
  const i = el('span', 'symbol-icon', icons[node.kind]); i.dataset.kind = node.kind; i.setAttribute('aria-hidden', 'true');
  if (node.kind === 'function' && node.definition !== undefined) {
    i.dataset.form = node.definition ? 'definition' : 'declaration';
  }
  return i;
}
function filename(uri: string) { return decodeURIComponent(uri.split('/').pop() ?? uri); }
const popup = el('div', 'node-details'); popup.hidden = true;
popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', 'Symbol details'); popup.id = 'symbol-details';
app.append(popup);
let popupAnchor: HTMLButtonElement | undefined;
let popupKey: string | undefined;
let closeTimer: ReturnType<typeof setTimeout> | undefined;
let hoverTimer: ReturnType<typeof setTimeout> | undefined;
let restoringFocus = false;
function hideDetails(restoreFocus = false) {
  clearTimeout(hoverTimer); clearTimeout(closeTimer); popup.hidden = true; popupKey = undefined;
  popupAnchor?.setAttribute('aria-expanded', 'false');
  if (restoreFocus && popupAnchor?.isConnected) { restoringFocus = true; popupAnchor.focus(); restoringFocus = false; }
}
function scheduleClose() {
  clearTimeout(hoverTimer); clearTimeout(closeTimer);
  closeTimer = setTimeout(() => { if (!popup.contains(document.activeElement)) hideDetails(); }, 180);
}
function scheduleHover(node: GraphNode, anchor: HTMLButtonElement) {
  clearTimeout(hoverTimer); clearTimeout(closeTimer);
  if (graph.classList.contains('panning') || !options.hidden) return;
  if (popupKey === node.key && !popup.hidden) return;
  hideDetails();
  hoverTimer = setTimeout(() => {
    if (anchor.isConnected && anchor.matches(':hover')) showDetails(node, anchor);
  }, 500);
}
function condition(text: string) {
  const line = el('div', 'condition');
  highlightC(text).forEach((tokens, index) => {
    if (index) line.append(document.createTextNode('\n'));
    for (const token of tokens) line.append(el('span', `syntax-${token.kind}`, token.text));
  });
  return line;
}
popup.onmouseenter = () => clearTimeout(closeTimer);
popup.onmouseleave = scheduleClose;
popup.addEventListener('focusout', event => { if (!popup.contains(event.relatedTarget as Node) && event.relatedTarget !== popupAnchor) hideDetails(); });
const options = el('div', 'context-menu'); options.hidden = true;
options.setAttribute('role', 'menu'); options.setAttribute('aria-label', 'Relation options'); app.append(options);
let menuAnchor: HTMLElement | undefined;
function closeOptions(restoreFocus = false) {
  options.hidden = true;
  if (restoreFocus) menuAnchor?.focus({ preventScroll: true });
}
function showOptions(event: MouseEvent | KeyboardEvent) {
  event.preventDefault(); hideDetails();
  menuAnchor = (event.target as HTMLElement).closest<HTMLElement>('.node-title') ?? graph;
  options.replaceChildren();
  if (menuAnchor.dataset.symbolId) {
    const key = menuAnchor.dataset.key;
    const pin = button('Pin this symbol', () => { closeOptions(); send('pinNode', { key }); });
    pin.setAttribute('role', 'menuitem'); options.append(pin);
  }
  const settings = button('Settings…', () => { closeOptions(); send('settings'); });
  settings.setAttribute('role', 'menuitem'); options.append(settings);
  const reset = button('Reset graph position', () => { closeOptions(); resetGraphPosition(); }); reset.setAttribute('role', 'menuitem'); options.append(reset);
  options.hidden = false;
  const anchor = menuAnchor.getBoundingClientRect();
  const x = 'clientX' in event ? event.clientX : anchor.left;
  const y = 'clientY' in event ? event.clientY : anchor.bottom;
  options.style.left = `${Math.max(4, Math.min(x, innerWidth - options.offsetWidth - 4))}px`;
  options.style.top = `${Math.max(4, Math.min(y, innerHeight - options.offsetHeight - 4))}px`;
  options.querySelector<HTMLButtonElement>('button')?.focus();
}
relation.oncontextmenu = showOptions;
graph.tabIndex = 0; graph.setAttribute('aria-label', 'Relation graph');
relation.addEventListener('keydown', event => {
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) showOptions(event);
});
options.onkeydown = event => {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeOptions(true); }
  if (event.key === 'Tab') closeOptions();
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const items = Array.from(options.querySelectorAll<HTMLButtonElement>('button'));
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
    items[next].focus();
  }
};
document.addEventListener('pointerdown', event => { if (!options.contains(event.target as Node)) closeOptions(); });
let drag: { id: number; x: number; y: number; panX: number; panY: number; moved: boolean } | undefined;
graph.onpointerdown = event => {
  if (event.button !== 0 || (event.target as HTMLElement).closest('.node, button, select')) return;
  hideDetails(); closeOptions();
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, panX, panY, moved: false };
  graph.setPointerCapture(event.pointerId);
};
graph.onpointermove = event => {
  if (!drag || drag.id !== event.pointerId) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 6) return;
  event.preventDefault(); drag.moved = true; graph.classList.add('panning');
  panX = drag.panX + dx; panY = drag.panY + dy; positionGraph();
};
function finishDrag() { drag = undefined; graph.classList.remove('panning'); }
graph.onpointerup = graph.onpointercancel = event => {
  if (graph.hasPointerCapture(event.pointerId)) graph.releasePointerCapture(event.pointerId);
  finishDrag();
};
graph.onlostpointercapture = finishDrag;
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !popup.hidden) { event.preventDefault(); hideDetails(true); }
});
document.addEventListener('pointerdown', event => {
  if (!popup.contains(event.target as Node) && !popupAnchor?.contains(event.target as Node)) hideDetails();
});
graph.addEventListener('scroll', () => hideDetails());
window.addEventListener('resize', () => hideDetails());
window.addEventListener('blur', () => hideDetails());
function showDetails(node: GraphNode, anchor: HTMLButtonElement) {
  if (restoringFocus) return;
  clearTimeout(closeTimer);
  if (popupKey === node.key && !popup.hidden) return;
  hideDetails(); popupAnchor = anchor; popupKey = node.key;
  anchor.setAttribute('aria-expanded', 'true');
  popup.replaceChildren(el('strong', `detail-name syntax-${node.kind}`, node.symbolId ? node.name : node.sites[0]?.name ?? node.name));
  const meta = el('div', 'detail-meta');
  meta.append(el('span', `detail-kind syntax-${node.kind}`, kindLabel(node)), document.createTextNode(' · '),
    el('span', 'detail-path', decodeURIComponent(node.location.uri)), el('span', 'detail-location', `:${node.location.line + 1}`));
  popup.append(meta);
  if (node.cycle) popup.append(el('div', 'condition detail-warning', 'Recursion: further expansion stopped on this path.'));
  if (node.ambiguous) popup.append(el('div', 'condition detail-warning', 'Candidate: inferred targets, conditions or multiple definitions prevent a unique match.'));
  if (node.sites.some(site => site.callKind === 'ai-candidate')) popup.append(el('div', 'condition detail-warning', 'Copilot candidate: source evidence suggests a possible callback target. This is not proof of invocation.'));
  if (node.callKind === 'macro') popup.append(el('div', 'condition detail-warning', 'Macro invocation: expansion is unavailable, incomplete, or leaves this recursive call.'));
  if (node.callKind === 'indirect') popup.append(el('div', 'condition detail-warning', 'Indirect call: the runtime function target has not been resolved.'));
  if (node.callKind === 'unresolved') popup.append(el('div', 'condition detail-warning', 'Unresolved call: no matching function or macro was found in the analyzed scope.'));
  if (node.conditions.length) popup.append(condition(node.conditions.join(' · ')));
  if (node.sites.length) popup.append(el('strong', 'detail-label', `${node.sites.length} ${node.sites[0].access ? 'variable use' : 'call/reference'} locations`));
  if (node.sites.some(site => site.access === 'address')) popup.append(el('div', 'condition', 'This location uses the address. Writes inside the receiving function are not tracked.'));
  for (const site of node.sites) {
    if (site.argument) {
      popup.append(el('strong', 'detail-label argument-label', `Function argument #${site.argument.position} · via ${site.argument.callee}`));
      popup.append(el('div', 'condition', 'Passing a function does not prove that the receiving code invokes it.'));
    }
    if (site.inference) {
      popup.append(el('strong', 'detail-label', `${site.callKind === 'ai-candidate' ? 'Copilot candidate' : site.argument ? 'Argument value' : 'Inferred call'} · ${site.inference.expression}`));
      popup.append(condition(site.inference.expression));
      if (site.inference.incomplete) popup.append(el('div', 'condition detail-warning', 'Other targets may exist. ' + site.inference.reasons.join(' · ')));
      for (const [i, frame] of site.inference.evidence.entries()) {
        const id = site.id + ':evidence:' + i;
        const item = button('', () => send('preview', { id }));
        item.className = 'site evidence';
        item.append(el('span', 'site-kind', 'Evidence'), el('span', 'detail-path', frame.reason + ' · '), el('span', 'detail-location', `${filename(frame.location.uri)}:${frame.location.line + 1}`));
        item.ondblclick = () => send('open', { id });
        item.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); send('open', { id }); } };
        popup.append(item);
      }
    }
    if (site.expansion) {
      popup.append(el('strong', 'detail-label', `Macro-expanded ${site.argument ? 'argument' : 'call'} · ${site.expansion.chain.map(frame => frame.name).join(' → ')}`));
      for (const frame of site.expansion.chain) popup.append(el('div', 'detail-meta', `${frame.name} · ${filename(frame.location.uri)}:${frame.location.line + 1}`));
      popup.append(condition(site.expansion.text));
    }
    const b = button('', () => send('preview', { id: site.id }));
    const kind = el('span', 'site-kind', site.argument ? 'Function argument' : site.kind === 'call' ? 'Call' : site.kind === 'declaration' ? 'Declaration' : 'Reference'); kind.dataset.kind = site.argument ? 'argument' : site.kind;
    b.append(site.access ? accessBadge(site.access) : kind, el('span', 'detail-path', filename(site.location.uri)),
      el('span', 'detail-location', `:${site.location.line + 1}:${site.location.column + 1}`));
    b.className = 'site'; b.dataset.site = site.id;
    b.title = [site.location.uri, ...site.conditions].join('\n');
    if (site.conditions.length) b.append(el('span', 'badge', 'Conditional'));
    b.ondblclick = () => send('open', { id: site.id });
    b.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); send('open', { id: site.id }); } };
    popup.append(b);
  }
  if (node.symbolId && !node.cycle && (!node.callKind || ['direct', 'expanded', 'inferred'].includes(node.callKind))) {
    const actions = el('div', 'node-actions');
    actions.append(button(node.expanded ? '− Collapse' : '+ Expand', () => send(node.expanded ? 'collapse' : 'expand', { key: node.key })),
      button('Levels…', () => send('expandSpecial', { key: node.key }), 'Levels to expand from this node (Shift+→)'));
    popup.append(actions);
  }
  popup.hidden = false;
  const rect = anchor.getBoundingClientRect(), width = popup.offsetWidth, height = popup.offsetHeight;
  let left = rect.right + 6;
  if (left + width > innerWidth - 8) left = rect.left - width - 6;
  popup.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, left))}px`;
  popup.style.top = `${Math.max(8, Math.min(innerHeight - height - 8, rect.top))}px`;
}
function drawNode(node: GraphNode): HTMLElement {
  const branch = el('div', 'branch');
  if (node.sites.length && node.sites.every(site => site.argument)) branch.classList.add('function-argument');
  const card = el('article', 'node'); card.dataset.nodeName = node.name;
  const openId = node.callKind || node.direction || node.sites.some(site => site.argument) || node.sites[0]?.access ? node.sites[0].id : node.symbolId ?? node.sites[0]?.id;
  const title = button('', event => { if (event.detail <= 1) send('selectNode', { key: node.key }); }, '');
  title.className = 'node-title'; title.dataset.key = node.key;
  if (node.symbolId) title.dataset.symbolId = node.symbolId;
  title.dataset.preview = openId;
  title.append(icon(node), el('span', 'symbol-name', node.symbolId ? node.name : node.sites[0]?.name ?? node.name));
  if (node.sites.some(site => site.callKind === 'ai-candidate')) title.append(el('span', 'badge', 'AI candidate'));
  const accesses = [...new Set(node.sites.flatMap(site => site.access ? [site.access] : []))];
  for (const access of accesses) title.append(accessBadge(access, true));
  const status = [node.cycle ? 'Recursive' : '', node.ambiguous ? 'Candidate' : '', node.callKind === 'indirect' ? 'Indirect call' : node.callKind === 'unresolved' ? 'Unresolved call' : '', node.conditions.length || node.sites.some(s => s.conditions.length) ? 'Conditional' : ''].filter(Boolean).join(', ');
  if (status) title.classList.add('uncertain');
  title.setAttribute('aria-label', [kindLabel(node) + ' ' + node.name, node.sites.some(site => site.argument) ? 'Function argument' : '', ...accesses.map(a => accessNames[a]), status].filter(Boolean).join(', '));
  title.setAttribute('aria-haspopup', 'dialog'); title.setAttribute('aria-controls', popup.id); title.setAttribute('aria-expanded', 'false');
  title.onmouseenter = () => scheduleHover(node, title);
  title.onmousemove = () => scheduleHover(node, title);
  title.onmouseleave = scheduleClose;
  title.onfocus = () => { if (title.matches(':focus-visible')) showDetails(node, title); };
  title.onblur = event => { if (!popup.contains(event.relatedTarget as Node)) hideDetails(); };
  title.onkeydown = event => {
    if (event.key === ' ') { event.preventDefault(); showDetails(node, title); }
    if (event.key === 'Tab' && !event.shiftKey && !popup.hidden && popupKey === node.key) {
      const first = popup.querySelector<HTMLButtonElement>('button');
      if (first) { event.preventDefault(); first.focus(); }
    }
    if (event.key === 'ArrowRight') { event.preventDefault(); send(event.shiftKey ? 'expandSpecial' : 'expand', { key: node.key }); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); send('collapse', { key: node.key }); }
    if (event.key === 'Enter') { event.preventDefault(); send('open', { id: openId }); }
  };
  card.append(title);
  branch.append(card);
  if (node.children.length) { const children = el('div', 'children'); node.children.forEach(n => children.append(drawNode(n))); branch.append(children); }
  return branch;
}
// Keep native selects mounted while background index/preview messages arrive.
const brand = el('strong', 'brand', `Dynsight v${__EXTENSION_VERSION__}`);
const mode = el('select');
const depth = el('select'); depth.setAttribute('aria-label', 'Depth');
for (let n = 1; n <= 8; n++) { const option = el('option', '', `${n} ${n === 1 ? 'level' : 'levels'}`); option.value = String(n); depth.append(option); }
depth.onchange = () => send('depth', { value: Number(depth.value) });
const lock = button('', () => send('lock'));
const goToPin = button('↩ Pin', () => {
  if (!rootKey) return;
  hideDetails(); finishDrag(); resetGraphPosition();
  graph.querySelector<HTMLElement>(':scope > .branch > .node > .node-title')?.scrollIntoView({ block: 'center', inline: 'center' });
  send('preview', { id: rootKey }); send('open', { id: rootKey });
}, 'Go to pinned symbol');
goToPin.setAttribute('aria-label', 'Go to pinned symbol'); goToPin.hidden = true;
const skipLabel = el('label', 'skip'); const skip = el('input'); skip.type = 'checkbox';
skipLabel.title = 'Skip branches disabled by literal #if/#elif 0 or 1. Macro conditions (#ifdef, #ifndef, defined) are kept; #define and #undef are not evaluated.';
skip.onchange = () => send('skip', { value: skip.checked }); skipLabel.append(skip, document.createTextNode('Skip inactive branches'));
toolbar.append(brand, mode, depth, lock, goToPin, skipLabel, button('Rebuild index', () => send('refresh')),
  button('Settings', () => send('settings'), 'Configure layout, sorting, call graph direction and analysis scope'),
  button('Help', () => send('help'), 'Open the bundled offline user guide'));
let variableMode: boolean | undefined;
let candidateSignature: string | undefined;
function renderContext(preview: ViewState['context']) {
  const previewNext = JSON.stringify(preview);
  if (previewNext !== previewSignature) {
    previewSignature = previewNext; context.replaceChildren();
    const heading = el('div', 'pane-heading'); heading.append(el('strong', '', `Context v${__EXTENSION_VERSION__}`), el('span', 'muted', preview ? `${preview.path}:${preview.location.line + 1}` : 'Code preview'));
    context.append(heading);
    if (preview) {
      const code = el('div', 'code');
      preview.text.split('\n').forEach((text, i) => {
        const line = el('div', 'code-line'); const number = i + preview.firstLine;
        if (number === preview.location.line) line.classList.add('highlight');
        line.append(el('span', 'line-number', String(number + 1)));
        const source = el('span', 'source');
        let column = 0;
        for (const token of preview.tokens[i] ?? [{ text, kind: 'plain' }]) {
          const span = el('span', `syntax-${token.kind}`, token.text);
          span.dataset.column = String(column); column += token.text.length; source.append(span);
        }
        if (!text) source.append(document.createTextNode(' '));
        line.onclick = event => {
          if (window.getSelection()?.isCollapsed === false) return;
          const token = (event.target as HTMLElement).closest<HTMLElement>('[data-column]');
          send('navigateContext', { uri: preview.location.uri, line: number, column: Number(token?.dataset.column ?? 0), text: text.replace(/\r$/, '') });
        };
        line.append(source); code.append(line);
      });
      context.append(code); code.querySelector('.highlight')?.scrollIntoView({ block: 'center' });
    } else context.append(el('div', 'empty', 'Select a symbol or call site in Relation.'));
  }
}
function render(state: ViewState) {
  const separate = state.contextLayout === 'separate';
  panes.classList.toggle('separate', separate); context.hidden = divider.hidden = separate;
  const variable = state.graph?.root.kind === 'variable';
  if (variable !== variableMode) {
    variableMode = variable;
    mode.setAttribute('aria-label', variable ? 'Variable access' : 'Relation type');
    mode.replaceChildren();
    const options = variable ? [['all', 'Variable · All uses'], ['read', 'R · Read (includes RW)'], ['write', 'W · Write (includes RW)'], ['readwrite', accessNames.readwrite], ['address', accessNames.address]]
      : [['references', 'References · All references'], ['callers', 'Callers · Direct calls'], ['callees', 'Callees · Called functions'], ['both', 'Callers & Callees']];
    for (const [value, label] of options) {
      const option = el('option', '', label); option.value = value; mode.append(option);
    }
  }
  const modeValue = variable ? state.accessFilter : state.mode;
  if (mode.value !== modeValue) mode.value = modeValue;
  mode.onchange = () => send(variable ? 'access' : 'mode', { value: mode.value });
  if (depth.value !== String(state.depth)) depth.value = String(state.depth);
  lock.textContent = state.locked ? 'Pinned · Follow paused' : 'Following selection'; lock.setAttribute('aria-pressed', String(state.locked));
  lock.disabled = !state.locked && !state.graph?.root.symbolId;
  lock.title = state.locked ? `Pinned to ${state.graph?.root.name ?? 'the current Relation'}. Click to unpin and follow the selected symbol. Right-click another node to change the pin.` : 'Click to pin the last symbol selected in Relation (or the current root) and pause following selection.';
  goToPin.hidden = !state.locked; goToPin.disabled = !state.graph?.root.symbolId;
  goToPin.title = state.graph ? `Go to pinned symbol: ${state.graph.root.name}` : 'Pinned symbol is unavailable';
  skip.checked = state.skipInactive;
  const choices = state.callback?.targets ?? state.candidates;
  const nextCandidates = JSON.stringify([choices, state.callback]);
  if (nextCandidates !== candidateSignature) {
    candidateSignature = nextCandidates;
    candidates.replaceChildren();
    candidates.classList.toggle('callback-candidates', !!state.callback);
    if (state.callback) {
      const note = el('span', 'muted callback-note', `Callback targets · ${state.callback.expression} · Candidates${state.callback.incomplete ? ' · Other targets may exist' : ''}`);
      note.title = state.callback.reasons.join('\n'); candidates.append(note);
      if (state.callback.reasons.length) {
        const diagnosis = el('details', 'callback-diagnosis');
        diagnosis.open = !choices.length;
        diagnosis.append(el('summary', '', 'Callback analysis'));
        for (const reason of state.callback.reasons) diagnosis.append(el('div', 'condition detail-warning', reason));
        candidates.append(diagnosis);
      }
    }
    if (choices.length) {
      const label = el('label', '', `${choices.length} ${state.callback ? (choices.length === 1 ? 'candidate' : 'candidates') : 'definitions'}`); label.htmlFor = 'definition-choice';
      const choice = el('select'); choice.id = 'definition-choice'; choice.setAttribute('aria-label', state.callback ? 'Select callback target' : 'Select definition');
      const placeholder = el('option', '', state.callback ? 'Select a callback target' : 'Select a file'); placeholder.value = ''; placeholder.disabled = true; placeholder.selected = true;
      choice.append(placeholder);
      for (const candidate of choices) {
        const option = el('option', '', `${state.callback ? candidate.name + ' · ' : ''}${decodeURIComponent(candidate.location.uri).replace(/^file:\/\//, '')}:${candidate.location.line + 1}`);
        option.value = candidate.id; choice.append(option);
      }
      choice.onchange = () => send('choose', { id: choice.value });
      candidates.append(label, choice);
    }
  }
  graphHeader.replaceChildren(el('strong', '', 'Relation'), el('span', 'muted', state.graph?.root.name ?? state.callback?.expression ?? state.candidates[0]?.name ?? 'Select a symbol'));
  if (state.graph) graphHeader.dataset.rootName = state.graph.root.name; else delete graphHeader.dataset.rootName;
  const nextRoot = state.graph?.root.symbolId;
  const rootChanged = nextRoot !== rootKey;
  const direction = state.graph?.callers ? state.callGraphDirection ?? 'callers-left' : undefined;
  const directionChanged = currentDirection !== direction;
  currentDirection = direction;
  if (rootChanged) { rootKey = nextRoot; finishDrag(); }
  const next = JSON.stringify([state.graph, direction, state.callback]);
  if (next !== signature) {
    const key = (document.activeElement as HTMLElement)?.dataset.key;
    hideDetails();
    signature = next; graph.replaceChildren();
    if (state.graph) {
      const tree = drawNode(state.graph.root);
      if (state.graph.callers) {
        tree.classList.add('dual-root');
        const outgoing = tree.querySelector<HTMLElement>(':scope > .children');
        outgoing?.classList.add('outgoing');
        if (direction === 'callees-left' && outgoing) {
          outgoing.classList.add('left-branches'); tree.prepend(outgoing);
        }
        if (state.graph.callers.length) {
          const incoming = el('div', 'children incoming');
          state.graph.callers.forEach(node => incoming.append(drawNode(node)));
          if (direction === 'callees-left') tree.append(incoming);
          else { incoming.classList.add('left-branches'); tree.prepend(incoming); }
        }
      }
      graph.append(tree);
    }
    else graph.append(el('div', 'empty', state.callback
      ? state.callback.targets.length ? 'Select a callback target above to explore its relations. Candidates do not prove runtime execution.' : 'No callback targets resolved at this call. Check analysis scope and notices; the pointer value may be unknown.'
      : state.candidates.length ? 'Select a definition above to show its references.' : 'Click a function or variable name in C source to show its references.'));
    positionGraph();
    if (rootChanged || directionChanged) resetGraphPosition();
    if (key) Array.from(graph.querySelectorAll<HTMLButtonElement>('.node-title')).find(b => b.dataset.key === key)?.focus({ preventScroll: true });
  }
  const rootTitle = graph.querySelector<HTMLButtonElement>(':scope > .branch > .node > .node-title');
  const marker = rootTitle?.querySelector('.pin-marker');
  if (rootTitle && state.locked) {
    if (!marker) {
      const pin = el('span', 'pin-marker'); pin.title = 'Pinned root'; pin.setAttribute('aria-hidden', 'true');
      pin.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" transform="rotate(35 8 8)" d="M5 1h6v2l-1 1v4l2 2v1H9v4l-1 1-1-1v-4H4v-1l2-2V4L5 3z"/></svg>';
      rootTitle.append(pin);
    }
    rootTitle.setAttribute('aria-description', 'Pinned root. Following selection is paused.');
  } else { marker?.remove(); rootTitle?.removeAttribute('aria-description'); }
  const preview = state.context;
  if (state.contextLayout !== 'separate') renderContext(preview);
  popup.querySelectorAll<HTMLElement>('.site').forEach(site => site.classList.toggle('selected', site.dataset.site === `${preview?.location.uri}@${preview?.location.start}`));
  graph.querySelectorAll<HTMLElement>('.node-title').forEach(title => title.classList.toggle('selected', title.dataset.preview === `${preview?.location.uri}#${preview?.location.start}` || title.dataset.preview === `${preview?.location.uri}@${preview?.location.start}`));
  footer.replaceChildren(el('span', '', `${state.status} · ${state.fileCount} files`), el('span', 'muted', 'Space Details · → Expand · ← Collapse · Shift+→ Levels · Enter Open source'));
  footer.append(button('Diagnostics', () => diagnostics?.open(), 'Show memory measurements for a screenshot'));
  diagnostics?.update(state.diagnostics, state);
  if (state.graph?.truncated) footer.append(el('span', 'warning', 'Limited to 300 nodes'));
  if (state.issues.length) {
    const details = el('details', 'warning'); details.append(el('summary', '', `Analysis notices: ${state.issues.length}`), el('pre', '', state.issues.slice(0, 100).join('\n'))); footer.append(details);
  }
}
window.addEventListener('message', event => {
  if (event.data?.type === 'diagnostics') diagnostics?.update(event.data.diagnostics);
  if (event.data?.type === 'state' && !contextOnly) render(event.data.state);
  if (event.data?.type === 'context' && contextOnly) renderContext(event.data.context);
});
send(contextOnly ? 'readyContext' : 'ready');
