import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const fixture = JSON.parse(await readFile('test-results/ui-fixture.json', 'utf8'));
const script = await readFile('dist/webview.js');
const css = await readFile('dist/webview.css');
const server = createServer((req, res) => {
  if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(script); }
  else if (req.url === '/app.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
  else res.end('<!doctype html><html lang="ko"><head><link rel="stylesheet" href="/app.css"></head><body><div id="app"></div><script src="/app.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1450, height: 700 }, colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const state = { graph: fixture.graph, candidates: [], status: 'Index ready', fileCount: 4, issues: [], mode: 'references', accessFilter: 'all', depth: 1, locked: false, skipInactive: true };
  const items = new Map();
  function collect(node) {
    if (node.symbolId) items.set(node.symbolId, node.location);
    for (const site of node.sites) items.set(site.id, site.location);
    node.children.forEach(collect);
  }
  collect(fixture.expandedGraph.root);
  collect(fixture.variableGraphs.all.root);
  function preview(id) {
    const location = items.get(id);
    const file = fixture.files.find(f => f.uri === location.uri);
    state.context = { location, text: file.text, tokens: file.tokens, firstLine: 0, path: file.uri.split('/').pop(), label: 'Preview' };
  }
  preview(fixture.graph.root.symbolId);
  await page.exposeFunction('bridge', async message => {
    if (message.type === 'preview') preview(message.id);
    if (message.type === 'selectNode') {
      const find = node => node.key === message.key ? node : node.children.map(find).find(Boolean);
      const node = find(state.graph.root);
      preview(node.sites[0]?.access ? node.sites[0].id : node.symbolId ?? node.sites[0]?.id);
      if (node.name === 'control_task') state.graph = fixture.expandedGraph;
    }
    if (message.type === 'expand') state.graph = fixture.expandedGraph;
    if (message.type === 'collapse') state.graph = fixture.graph;
    if (message.type === 'lock') state.locked = !state.locked;
    if (message.type === 'depth') state.depth = message.value;
    if (message.type === 'access') { state.accessFilter = message.value; state.graph = fixture.variableGraphs[message.value]; }
    await page.evaluate(state => window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', state } })), state);
  });
  await page.addInitScript(() => {
    window.sent = [];
    window.acquireVsCodeApi = () => ({ postMessage(message) { window.sent.push(message); void window.bridge(message); } });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('[data-node-name="check_fault"]').waitFor({ timeout: 3000 });
  await page.getByRole('button', { name: 'Settings', exact: true }).click({ timeout: 3000 });
  assert.ok(await page.evaluate(() => window.sent.some(m => m.type === 'settings')), 'Settings button requests scope configuration');
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  assert.ok(await page.evaluate(() => window.sent.some(m => m.type === 'help')), 'Help button requests offline guide');
  for (const form of ['declaration', 'definition']) {
    const glyph = page.locator(`.symbol-icon[data-form="${form}"]`).first();
    assert.equal(await glyph.locator('svg').count(), 1, `${form} uses a vector icon`);
    const box = await glyph.boundingBox();
    assert.equal(box.width, 16, 'function icon keeps the original width');
    assert.equal(box.height, 16, 'function icon keeps the original height');
    const node = glyph.locator('..');
    assert.ok((await node.getAttribute('aria-label')).includes(`Function ${form}`));
    await node.focus();
    await page.keyboard.press('Space');
    assert.equal(await page.locator('.detail-kind').textContent(), `Function ${form}`);
    await page.keyboard.press('Escape');
  }
  const depthSelector = page.getByRole('combobox', { name: 'Depth', exact: true });
  for (const level of [2, 3, 4, 5]) {
    await depthSelector.click();
    await page.evaluate(state => {
      const selector = document.querySelector('[aria-label="Depth"]');
      for (let count = 1; count <= 5; count++) {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', state: { ...state, status: 'Indexing C sources…', fileCount: count } } }));
      }
      window.depthStillFocused = selector.isConnected && document.activeElement === selector;
    }, state);
    assert.equal(await page.evaluate(() => window.depthStillFocused), true, 'index progress must preserve the open depth selector and focus');
    await page.keyboard.press('Escape');
    await depthSelector.selectOption(String(level));
    await page.waitForFunction(level => window.sent.some(m => m.type === 'depth' && m.value === level), level);
    assert.equal(await depthSelector.inputValue(), String(level));
  }
  await depthSelector.selectOption('1');
  await page.getByRole('combobox', { name: 'Relation type' }).click();
  assert.equal(await page.evaluate(state => {
    const selector = document.activeElement;
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', state: { ...state, graph: undefined } } }));
    return selector.isConnected && document.activeElement === selector;
  }, state), true, 'graph updates preserve the relation type selector');
  await page.keyboard.press('Escape');
  await page.evaluate(state => window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', state } })), state);
  const caller = page.locator('[data-node-name="control_task"]');
  for (const delay of [0, 150, 300]) {
    const openCount = await page.evaluate(() => window.sent.filter(m => m.type === 'open').length);
    await caller.locator('.node-title').dblclick({ delay });
    await page.waitForFunction(count => window.sent.filter(m => m.type === 'open').length > count, openCount);
    assert.equal(await page.evaluate(() => window.sent.filter(m => m.type === 'open').at(-1).id), fixture.graph.root.children.find(node => node.name === 'control_task').symbolId, 'double-click opens the original symbol after expansion moves nodes');
    state.graph = fixture.graph;
    preview(fixture.graph.root.symbolId);
    await page.evaluate(state => window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', state } })), state);
  }
  assert.ok((await caller.boundingBox()).height <= 26, 'compact single-line node');
  assert.equal(await caller.locator('.site').count(), 0);
  const popup = page.getByRole('dialog', { name: 'Symbol details' });
  await caller.hover();
  await page.waitForTimeout(300);
  assert.equal(await popup.isVisible(), false, 'hover waits for 500 ms');
  const callerBox = await caller.boundingBox();
  await page.mouse.move(callerBox.x + 12, callerBox.y + 12);
  await page.waitForTimeout(300);
  assert.equal(await popup.isVisible(), false, 'moving within the node restarts the wait');
  await popup.waitFor({ state: 'visible', timeout: 500 });
  const popupColors = await popup.evaluate(p => ['.detail-name', '.detail-location', '.site-kind'].map(selector => getComputedStyle(p.querySelector(selector)).color));
  assert.equal(new Set(popupColors).size, 3, 'popup distinguishes symbol, location and reference kind');

  assert.equal(await popup.locator('.site').count(), 2);
  assert.ok((await caller.boundingBox()).height <= 26, 'hover does not resize graph');
  await mkdir('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/relation-hover.png', fullPage: true });
  await popup.locator('.site').nth(1).click();
  assert.ok((await page.locator('.code-line.highlight').textContent()).includes('check_fault(2)'));
  assert.equal(await page.locator('.code-line.highlight .syntax-function').textContent(), 'check_fault');
  const contextCall = page.locator('.code-line.highlight .syntax-function');
  await contextCall.click();
  const contextNavigation = await page.evaluate(() => window.sent.filter(m => m.type === 'navigateContext').at(-1));
  assert.ok(contextNavigation, 'Context code click sends navigation');
  assert.equal(contextNavigation.uri, state.context.location.uri);
  assert.equal(contextNavigation.line, state.context.location.line);
  assert.equal(contextNavigation.column, state.context.text.split('\n')[contextNavigation.line].indexOf('check_fault'));
  const navigationCount = await page.evaluate(() => window.sent.filter(m => m.type === 'navigateContext').length);
  const callBox = await contextCall.boundingBox();
  await page.mouse.move(callBox.x + 1, callBox.y + callBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(callBox.x + callBox.width - 1, callBox.y + callBox.height / 2, { steps: 5 });
  await page.mouse.up();
  assert.equal(await page.evaluate(() => window.sent.filter(m => m.type === 'navigateContext').length), navigationCount, 'drag selection does not navigate');
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  assert.ok(await page.locator('.syntax-type').count() > 0);
  assert.equal(await page.locator('[data-root-name]').getAttribute('data-root-name'), 'check_fault');
  assert.equal(await page.locator('[data-node-name="fault_handlers"] .symbol-icon').getAttribute('data-kind'), 'variable');
  await caller.locator('.node-title').focus();
  await page.keyboard.press('ArrowRight');
  await page.locator('[data-node-name="main"]').first().waitFor({ timeout: 3000 });
  assert.ok(await page.evaluate(() => window.sent.some(m => m.type === 'expand')));
  await caller.locator('.node-title').focus();
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => !document.querySelector('[data-node-name="main"]'));
  await caller.locator('.node-title').focus();
  await page.keyboard.press('Shift+ArrowRight');
  assert.ok(await page.evaluate(() => window.sent.some(m => m.type === 'expandSpecial')));
  await caller.hover();
  await popup.locator('.site').first().dblclick();
  assert.ok(await page.evaluate(() => window.sent.some(m => m.type === 'open')));
  await page.keyboard.press('Escape');
  await popup.waitFor({ state: 'hidden' });
  await caller.locator('.node-title').click();
  assert.ok((await page.locator('.code-line.highlight').textContent()).includes('control_task(void)'));
  assert.ok(await page.evaluate(() => window.sent.some(m => m.type === 'selectNode')), 'node click requests preview and expansion together');
  await page.keyboard.press('Space');
  await popup.waitFor({ state: 'visible' });
  await page.keyboard.press('Tab');
  assert.ok(await popup.evaluate(p => p.contains(document.activeElement)), 'keyboard access to popup');
  await page.keyboard.press('Escape');
  await page.mouse.move(10, 10);
  await caller.hover();
  await page.waitForTimeout(400);
  await page.mouse.move(10, 10);
  await page.waitForTimeout(750);
  assert.equal(await popup.isVisible(), false, 'leaving cancels pending popup');
  await caller.locator('.node-title').click();
  await page.waitForTimeout(300);
  assert.equal(await popup.isVisible(), false, 'mouse focus cannot bypass hover delay');
  await page.keyboard.press('Space');
  await popup.waitFor({ state: 'visible', timeout: 500 });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Following selection', exact: true }).click();
  const pinned = page.getByRole('button', { name: 'Pinned · Follow paused', exact: true });
  assert.equal(await pinned.getAttribute('aria-pressed'), 'true');
  await pinned.click();
  assert.equal(await page.getByRole('button', { name: 'Following selection', exact: true }).getAttribute('aria-pressed'), 'false');
  const divider = page.getByRole('separator');
  await divider.focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await divider.getAttribute('aria-valuenow'), '39');
  assert.deepEqual(errors, []);
  await mkdir('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/relation-context.png', fullPage: true });
  const functionIconColors = await page.locator('.symbol-icon[data-form]').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).color));
  await page.evaluate(() => document.body.classList.add('vscode-light'));
  assert.notDeepEqual(await page.locator('.symbol-icon[data-form]').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).color)), functionIconColors, 'function icons use stronger colors on light backgrounds');
  const colors = await page.evaluate(() => ['function', 'type', 'keyword'].map(kind => getComputedStyle(document.querySelector('.syntax-' + kind)).color));
  assert.equal(new Set(colors).size, 3, 'distinct syntax colors in light theme');
  await page.screenshot({ path: 'output/playwright/relation-context-light.png', fullPage: true });
  await caller.locator('.node-title').focus();
  await page.keyboard.press('Space');
  await popup.waitFor({ state: 'visible' });
  const lightPopupColors = await popup.evaluate(p => ['.detail-name', '.detail-location', '.site-kind'].map(selector => getComputedStyle(p.querySelector(selector)).color));
  assert.equal(new Set(lightPopupColors).size, 3, 'popup tint also distinguishes information in light theme');
  await page.screenshot({ path: 'output/playwright/relation-hover-light.png', fullPage: true });
  await page.locator('[data-node-name="optional_task"] .node-title').focus();
  await page.keyboard.press('Space');
  assert.ok(await popup.locator('.condition .syntax-preprocessor').count() > 0, 'popup conditions use syntax colors');
  await page.keyboard.press('Escape');
  state.graph = fixture.variableGraphs.all;
  state.depth = 2;
  state.mode = 'callers';
  preview(state.graph.root.symbolId);
  await page.evaluate(state => window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', state } })), state);
  const accessSelector = page.getByRole('combobox', { name: 'Variable access' });
  assert.equal(await accessSelector.inputValue(), 'all');
  assert.equal(await page.getByRole('combobox', { name: 'Relation type' }).count(), 0);
  assert.equal(await page.locator('[data-node-name="state"] .symbol-icon').getAttribute('data-kind'), 'variable');
  for (const theme of ['vscode-light', 'vscode-dark']) {
    await page.evaluate(theme => { document.body.className = theme; }, theme);
    const colors = await page.locator('.graph .access-badge').evaluateAll(badges => badges.map(b => getComputedStyle(b).color));
    assert.equal(new Set(colors).size, 4, 'four access colors in each theme');
  }
  const writer = page.locator('[data-node-name="writer"]');
  assert.ok((await writer.boundingBox()).height <= 26, 'access badges preserve compact node height');
  assert.equal(await writer.locator('.access-badge').textContent(), 'W');
  await writer.locator('.node-title').click();
  assert.ok((await page.locator('.code-line.highlight').textContent()).includes('state = 1;'), 'variable node previews actual use');
  await page.keyboard.press('Space');
  await popup.waitFor({ state: 'visible' });
  assert.equal(await popup.locator('[data-access="write"]').count(), 2);
  await popup.locator('.site').nth(1).click();
  assert.ok((await page.locator('.code-line.highlight').textContent()).includes('state = 2;'));
  assert.equal(await page.locator('[data-root-name]').getAttribute('data-root-name'), 'state');
  await page.screenshot({ path: 'output/playwright/variable-access.png', fullPage: true });
  await page.keyboard.press('Escape');
  for (const [filter, names] of [['read', ['reader', 'updater']], ['write', ['updater', 'writer']], ['readwrite', ['updater']], ['address', ['escape']]]) {
    await accessSelector.selectOption(filter);
    await page.waitForFunction(value => document.querySelector('[aria-label="Variable access"]').value === value, filter);
    const direct = await page.locator('.graph > .branch > .children > .branch > .node').evaluateAll(nodes => nodes.map(n => n.dataset.nodeName));
    assert.deepEqual(direct, names);
  }
  await page.locator('[data-node-name="escape"] .node-title').focus();
  await page.keyboard.press('Space');
  assert.ok((await popup.textContent()).includes('Writes inside the receiving function are not tracked'));
  await page.keyboard.press('Escape');
  state.graph = fixture.graph;
  await page.evaluate(state => window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', state } })), state);
  assert.equal(await page.getByRole('combobox', { name: 'Relation type' }).inputValue(), 'callers', 'function mode is preserved');
  const prefix = '/* 한글 😀 */ ';
  const unicodePreview = { ...state.context, firstLine: 120, text: prefix + 'state++;\r', tokens: [[
    { text: prefix, kind: 'comment' }, { text: 'state', kind: 'variable' }, { text: '++;\r', kind: 'plain' }
  ]] };
  await page.evaluate(state => window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', state } })), { ...state, context: unicodePreview });
  await page.locator('.context .syntax-variable').click();
  const unicodeNavigation = await page.evaluate(() => window.sent.filter(m => m.type === 'navigateContext').at(-1));
  assert.equal(unicodeNavigation.line, 120, 'Context uses original file line numbers');
  assert.equal(unicodeNavigation.column, prefix.length, 'Context columns use UTF-16 including emoji');
  assert.equal(unicodeNavigation.text, prefix + 'state++;', 'CRLF lines match VS Code line text');
  const manyCandidates = Array.from({ length: 80 }, (_, i) => ({ id: `port-${i}`, name: 'PORT_READY', location: { uri: `file:///workspace/portable/port-${i}/portmacro.h`, line: 10 } }));
  await page.evaluate(state => window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', state } })), { ...state, graph: undefined, context: undefined, candidates: manyCandidates });
  const chooser = page.getByRole('combobox', { name: 'Select definition' });
  assert.equal(await chooser.count(), 1, 'many definitions use a single compact chooser');
  assert.ok((await page.locator('.candidates').boundingBox()).height <= 36);
  assert.ok((await page.locator('.graph').boundingBox()).height > 500, 'candidate list preserves graph space');
  assert.ok((await chooser.locator('option').nth(2).textContent()).includes('port-1/portmacro.h'));
  assert.ok((await page.locator('.relation .pane-heading').textContent()).includes('PORT_READY'));
  await chooser.click();
  assert.equal(await page.evaluate(state => {
    const selector = document.activeElement;
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', state } }));
    return selector.isConnected && document.activeElement === selector;
  }, { ...state, graph: undefined, context: undefined, candidates: manyCandidates, fileCount: 10 }), true, 'index updates preserve the definition chooser');
  await page.keyboard.press('Escape');
  await chooser.selectOption('port-1');
  assert.ok(await page.evaluate(() => window.sent.some(m => m.type === 'choose' && m.id === 'port-1')));
  await page.setViewportSize({ width: 520, height: 700 });
  assert.ok(await page.locator('.context').isVisible());
  assert.ok(await page.locator('.relation').isVisible());
  assert.equal(await divider.isVisible(), false);
  await writeFile('test-results/ui.json', JSON.stringify({ passed: true, checks: ['Context click coordinates and drag selection', 'Context UTF-16 and CRLF coordinates', 'variable filters R/W/RW/address', 'variable badges preserve one-line height', 'variable click and popup preview exact use sites', 'variable access colors in dark/light themes', 'function mode preserved', '500-ms stationary hover with movement reset and leave cancellation', 'mouse click does not bypass delay', 'popup tint and condition syntax in dark/light themes', 'single-line graph nodes', 'hover popup without layout shift', 'Context selected call and symbol', 'syntax colors in dark/light themes', 'keyboard popup access and Escape', 'root preserved', 'variable icon', 'keyboard expansion/collapse/special', 'explicit source open', 'lock toggle', 'split resize', 'narrow layout', '80 candidates keep graph space and distinguish paths'], errors }, null, 2));
  assert.deepEqual(errors, []);
  console.log('Browser UI checks passed, including variable access filters, colors and actual-site previews');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
