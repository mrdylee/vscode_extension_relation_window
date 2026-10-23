// Diagnostic reproduction updated to assert the repaired caller-region boundary.
// Run: npx tsx docs/reviews/2026-10-23-partial-context-repro.ts
import assert from 'node:assert/strict';
import { createAnalyzer } from '../../src/analyzer';

async function main() {
  for (const [callers, objectsPerCall] of [[8, 9], [32, 9], [1, 257]]) {
    for (const shared of [true, false]) {
      const parser = await createAnalyzer('node_modules/web-tree-sitter/web-tree-sitter.wasm', 'node_modules/tree-sitter-c/tree-sitter-c.wasm');
      let source = 'typedef void(*CB)(void);typedef struct Node{CB cb;struct Node*next;}Node;void target(void){}void opaque(Node*);';
      for (let caller = 0; caller < callers; caller++) for (let depth = objectsPerCall - 1; depth >= 0; depth--)
        source += `Node node${caller}_${depth}={target,${depth === objectsPerCall - 1 ? '0' : `&node${caller}_${depth + 1}`}};`;
      if (shared) source += 'void visit(Node*p){p->cb();opaque(p);}';
      for (let caller = 0; caller < callers; caller++) {
        if (!shared) source += `void visit${caller}(Node*p){p->cb();opaque(p);}`;
        source += `void run${caller}(void){visit${shared ? '' : caller}(&node${caller}_0);}`;
      }
      const raw = parser.analyze('file:///partial-context-repro.c', source, true, { expandMacros: false, propagateCallbacks: true });
      const [result] = parser.derive([raw]);
      const regionLimited = result.issues.some(issue => issue.startsWith('Callback region limit'));
      assert.equal(regionLimited, objectsPerCall > 256);
      assert.ok(result.references.some(ref => ref.callKind === 'inferred' && ref.name === 'target'));
      console.log(JSON.stringify({ callers, objectsPerCall, totalObjects: callers * objectsPerCall, shared, regionLimited }));
    }
  }
}
void main();
