import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highlightC } from '../src/syntax';

test('C syntax colors distinguish function, type, keyword, macro, number and variable', () => {
  const lines = highlightC('#define LIMIT 10\nTickType_t ticks = 0x12U;\nif (ticks < LIMIT) vTaskDelay(ticks);');
  const tokens = lines.flat();
  for (const [text, kind] of [['#define', 'preprocessor'], ['TickType_t', 'type'], ['ticks', 'variable'], ['0x12U', 'number'], ['if', 'keyword'], ['LIMIT', 'macro'], ['vTaskDelay', 'function']]) {
    assert.ok(tokens.some(t => t.text === text && t.kind === kind), `${text}: ${kind}`);
  }
});
test('multiline comments and escaped strings protect embedded function names and preserve source', () => {
  const source = '/* target();\n' + 'still comment\n'.repeat(100) + '*/\nconst char *s = "target(\\\"text\\\")"; // other();\nvoid real(void) { real(); }\n';
  const lines = highlightC(source);
  assert.equal(lines.map(line => line.map(t => t.text).join('')).join('\n'), source);
  assert.ok(lines.slice(80, 100).every(line => line.every(t => t.kind === 'comment')));
  assert.deepEqual(lines.flat().filter(t => t.kind === 'function').map(t => t.text), ['real', 'real']);
  assert.ok(lines.flat().some(t => t.kind === 'string' && t.text.includes('target')));
});
test('indented preprocessor directives and unfinished multiline comments keep their colors', () => {
  const lines = highlightC('void task(void){}\n    #if configUSE_TIMERS\n/* unfinished\nstill a comment');
  assert.ok(lines[1].some(t => t.kind === 'preprocessor' && t.text.trim() === '#if'));
  assert.ok(lines[3].every(t => t.kind === 'comment'));
});
