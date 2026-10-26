import { build } from 'esbuild';
import { mkdir, copyFile, readFile } from 'node:fs/promises';
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
await mkdir('dist', { recursive: true });
await Promise.all([
  build({ entryPoints: ['src/extension.ts'], outfile: 'dist/extension.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['vscode', 'web-tree-sitter/web-tree-sitter.wasm'], define: { 'import.meta.url': 'extensionModuleUrl' }, banner: { js: 'const extensionModuleUrl = require("node:url").pathToFileURL(__filename).href;' } }),
  build({ entryPoints: ['src/analysis-worker.ts'], outfile: 'dist/analysis-worker.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node20', define: { 'import.meta.url': 'workerModuleUrl' }, banner: { js: 'const workerModuleUrl = require("node:url").pathToFileURL(__filename).href;' } }),
  build({ entryPoints: ['webview/main.ts'], outfile: 'dist/webview.js', bundle: true, platform: 'browser', format: 'iife', target: 'es2022', define: { __EXTENSION_VERSION__: JSON.stringify(version) } }),
  build({ entryPoints: ['test/extension.test.ts'], outfile: 'dist/extension.test.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'] }),
  build({ entryPoints: ['test/large-workspace.test.ts'], outfile: 'dist/large-workspace.test.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'] }),
  build({ entryPoints: ['test/freertos.test.ts'], outfile: 'dist/freertos.test.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'] }),
  copyFile('node_modules/web-tree-sitter/web-tree-sitter.wasm', 'dist/web-tree-sitter.wasm'),
  copyFile('node_modules/tree-sitter-c/tree-sitter-c.wasm', 'dist/tree-sitter-c.wasm'),
  copyFile('vendor/tree-sitter-make/tree-sitter-make.wasm', 'dist/tree-sitter-make.wasm'),
  copyFile('webview/styles.css', 'dist/webview.css')
]);
