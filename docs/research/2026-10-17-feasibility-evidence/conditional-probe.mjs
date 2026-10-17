import { Parser, Language } from 'web-tree-sitter';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';

await Parser.init();
const parser = new Parser();
parser.setLanguage(await Language.load('./node_modules/tree-sitter-c/tree-sitter-c.wasm'));

// Feasibility probe only: literal #if 0/1; other conditions remain unknown.
function visibleCalls(node, output = []) {
  if (node.type === 'preproc_if' || node.type === 'preproc_elif') {
    const condition = node.childForFieldName('condition');
    const alternative = node.childForFieldName('alternative');
    const value = condition.type === 'number_literal' && ['0', '1'].includes(condition.text)
      ? Number(condition.text) : undefined;
    if (value !== 0) {
      for (const child of node.namedChildren) {
        if (child.id !== condition.id && child.id !== alternative?.id) visibleCalls(child, output);
      }
    }
    if (value !== 1 && alternative) visibleCalls(alternative, output);
    return output;
  }
  if (node.type === 'call_expression') output.push(node.text);
  for (const child of node.namedChildren) visibleCalls(child, output);
  return output;
}

const cases = [
  { name: '#if 0 excludes its body and keeps else', body: '#if 0\nold();\n#else\ncurrent();\n#endif', expected: ['current()'] },
  { name: 'outer #if 0 excludes nested active branch', body: '#if 0\n#if 1\nnested();\n#endif\n#else\ncurrent();\n#endif', expected: ['current()'] },
  { name: '#elif 1 selected after #if 0, trailing else excluded', body: '#if 0\nold();\n#elif 1\ncurrent();\n#else\nother();\n#endif', expected: ['current()'] },
  { name: 'unknown condition retains both possible branches, including known inner filtering', body: '#if FEATURE\n#if 0\nold();\n#else\nfeature();\n#endif\n#else\nfallback();\n#endif', expected: ['feature()', 'fallback()'] }
];
const results = [];
for (const fixture of cases) {
  const tree = parser.parse(`void task(void) {\n${fixture.body}\n}`);
  assert.equal(tree.rootNode.hasError, false);
  const actual = visibleCalls(tree.rootNode);
  assert.deepEqual(actual, fixture.expected);
  results.push({ ...fixture, actual, passed: true });
  console.log(`PASS ${fixture.name}`);
  tree.delete();
}
writeFileSync('conditional-results.json', JSON.stringify({ results, limitations: 'Literal 0/1 only; no full preprocessor, macro expansion, or product integration.' }, null, 2) + '\n');
parser.delete();
