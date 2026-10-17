import { Parser, Language } from 'web-tree-sitter';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';

await Parser.init();
const parser = new Parser();
parser.setLanguage(await Language.load('./node_modules/tree-sitter-c/tree-sitter-c.wasm'));
const results = [];
function parse(source) {
  const tree = parser.parse(source);
  return { tree, root: tree.rootNode, calls: tree.rootNode.descendantsOfType('call_expression') };
}
function check(name, run) {
  run();
  results.push({ name, passed: true });
  console.log(`PASS ${name}`);
}
check('direct calls retain both source locations; declaration/comment/string/address are not calls', () => {
  const source = '#include "missing_sdk.h"\nvoid fault(int);\nvoid task(void) {\n  fault(1);\n  fault(2);\n  // fault(3);\n  const char *s = "fault(4)";\n  void (*handler)(int) = fault;\n}\n';
  const { tree, root, calls } = parse(source);
  assert.equal(root.hasError, false);
  assert.deepEqual(calls.map(n => [n.text, n.startPosition.row + 1]), [['fault(1)', 4], ['fault(2)', 5]]);
  tree.delete();
});
check('same-named static definitions retain separate file identities, without resolving references', () => {
  const files = { 'a.c': 'static void helper(void) {}\nvoid a(void) { helper(); }', 'b.c': 'static void helper(void) {}\nvoid b(void) { helper(); }' };
  const definitions = Object.entries(files).flatMap(([file, source]) => {
    const { tree, root } = parse(source);
    const items = root.descendantsOfType('function_definition').map(n => ({ file, declaration: n.childForFieldName('declarator').text }));
    assert.equal(root.hasError, false);
    tree.delete();
    return items;
  });
  assert.equal(definitions.filter(d => d.declaration.startsWith('helper')).length, 2);
  assert.equal(new Set(definitions.map(d => d.file)).size, 2);
});
check('both preprocessor branches remain visible without build flags', () => {
  const { tree, root, calls } = parse('void task(void) {\n#if BOARD_A\n  a();\n#else\n  b();\n#endif\n}\n');
  assert.equal(root.hasError, false);
  assert.deepEqual(calls.map(n => n.text), ['a()', 'b()']);
  assert.equal(root.descendantsOfType('preproc_if').length, 1);
  tree.delete();
});
check('function-pointer calls are syntax calls; a separate resolver is required', () => {
  const { tree, root, calls } = parse('void run(void (*handler)(void)) { handler(); (*handler)(); }');
  assert.equal(root.hasError, false);
  assert.deepEqual(calls.map(n => n.childForFieldName('function').type), ['identifier', 'parenthesized_expression']);
  assert.ok(root.descendantsOfType('pointer_declarator').length > 0);
  tree.delete();
});
check('macro invocation is parsed but its body is not expanded into a function call', () => {
  const { tree, root, calls } = parse('#define CHECK(x) fault(x)\nvoid task(void) { CHECK(1); }\n');
  assert.equal(root.hasError, false);
  assert.deepEqual(calls.map(n => n.text), ['CHECK(1)']);
  assert.equal(root.descendantsOfType('preproc_function_def').length, 1);
  tree.delete();
});
check('function-pointer table and initializer are identifiable as declaration syntax', () => {
  const { tree, root, calls } = parse('void fault(void);\nvoid (*handlers[])(void) = { fault };\n');
  assert.equal(root.hasError, false);
  assert.equal(calls.length, 0);
  assert.ok(root.descendantsOfType('array_declarator').length > 0);
  assert.ok(root.descendantsOfType('pointer_declarator').length > 0);
  assert.deepEqual(root.descendantsOfType('initializer_list').map(n => n.text), ['{ fault }']);
  tree.delete();
});
check('Korean and emoji before a multiline call preserve JavaScript text offsets', () => {
  const source = 'void task(void) { /* 한글 😀 */ fault(\n  1); }';
  const { tree, root, calls } = parse(source);
  assert.equal(root.hasError, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].startIndex, source.indexOf('fault'));
  assert.equal(calls[0].startPosition.column, source.indexOf('fault'));
  assert.equal(source.slice(calls[0].startIndex, calls[0].endIndex), 'fault(\n  1)');
  tree.delete();
});
check('local variable shadowing is retained in syntax; name-only matching would be unsafe', () => {
  const { tree, root, calls } = parse('void fault(void);\nvoid task(void (*fault)(void)) { fault(); }');
  assert.equal(root.hasError, false);
  assert.equal(calls[0].childForFieldName('function').text, 'fault');
  assert.ok(root.descendantsOfType('parameter_declaration')[1].text.includes('(*fault)'));
  tree.delete();
});

const observations = [];
for (const source of ['__interrupt void irq(void) { fault(); }', 'void irq(void) __interrupt(1) { fault(); }', 'void task(void) { fault(']) {
  const { tree, root, calls } = parse(source);
  observations.push({ source, hasError: root.hasError, calls: calls.map(n => n.text), errorNodes: root.descendantsOfType('ERROR').map(n => n.text) });
  tree.delete();
}
const report = {
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  packages: { 'web-tree-sitter': '0.27.1', 'tree-sitter-c': '0.24.1' },
  results, observations,
  limitations: ['Syntax extraction only; no project-wide resolver was implemented.', 'No VS Code extension or UI was executed.', 'No real project performance or cross-platform validation.']
};
writeFileSync('results.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: results.length, observations }, null, 2));
parser.delete();
