import { mkdtemp, readFile, writeFile, copyFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'node_modules/tree-sitter-make');
const cli = path.join(root, 'node_modules/tree-sitter-cli/cli.js');
const temp = await mkdtemp(path.join(tmpdir(), 'dynsight-make-grammar-'));
try {
  const { version } = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
  if (version !== '1.1.1') throw new Error('Review the grammar patch before upgrading tree-sitter-make');
  const grammar = await readFile(path.join(source, 'grammar.js'), 'utf8');
  const before = "field('replacement', $._primary)";
  if (grammar.split(before).length !== 2) throw new Error('Make substitution grammar patch no longer applies');
  await writeFile(path.join(temp, 'grammar.js'), grammar.replace(before, `optional(${before})`));
  await copyFile(path.join(source, 'tree-sitter.json'), path.join(temp, 'tree-sitter.json'));
  execFileSync(process.execPath, [cli, 'generate'], { cwd: temp, stdio: 'inherit' });
  execFileSync(process.execPath, [cli, 'build', '--wasm'], { cwd: temp, stdio: 'inherit' });
  const destination = path.join(root, 'vendor/tree-sitter-make');
  await mkdir(destination, { recursive: true });
  await copyFile(path.join(temp, 'tree-sitter-make.wasm'), path.join(destination, 'tree-sitter-make.wasm'));
} finally {
  await rm(temp, { recursive: true, force: true });
}
