import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchSavedSymbol, readSlots, SavedSlot, SavedSymbol } from '../src/relation-slots';

const target: SavedSymbol = { id: 'file:///a.c#10', uri: 'file:///a.c', name: 'run', kind: 'function',
  start: 10, definition: true, storage: 'static', sourceDigest: 'before' };
const slot: SavedSlot = { target, locked: false, options: { mode: 'both', depth: 2, accessFilter: 'all',
  calleeSort: 'name', callGraphDirection: 'callers-left', includeFunctionArguments: true },
  branches: [{ parent: null, symbol: target, direction: 'callees', levels: 2 }] };

test('empty storage always provides five independent slots', () => {
  for (const input of [undefined, null, {}, 'old', []]) assert.deepEqual(readSlots(input), [null, null, null, null, null]);
});
test('slot round-trip preserves numbering and owns its records', () => {
  const input = [slot, null, { ...slot, locked: true }, null, slot];
  const loaded = readSlots(input);
  assert.deepEqual(loaded, input);
  loaded[0]!.target.name = 'changed'; loaded[0]!.branches[0].levels = 0;
  assert.equal(target.name, 'run'); assert.equal(slot.branches[0].levels, 2);
  assert.equal(loaded[4]!.target.name, 'run');
});
test('malformed entries never shift a later slot', () => {
  for (const bad of [{ ...slot, locked: 'yes' }, { ...slot, options: { ...slot.options, depth: 9 } },
    { ...slot, target: { ...target, kind: 'unknown' } }, { ...slot, branches: [{ ...slot.branches[0], parent: 0 }] },
    { ...slot, branches: [{ ...slot.branches[0], levels: -1 }] }, { ...slot, branches: Array(301).fill(slot.branches[0]) }]) {
    const loaded = readSlots([slot, bad, slot, null, slot]);
    assert.equal(loaded[1], null); assert.equal(loaded[2]?.target.name, 'run'); assert.equal(loaded[4]?.target.name, 'run');
  }
});
test('unique symbols survive moved source coordinates', () => {
  const moved = { ...target, id: 'file:///a.c#40', start: 40, sourceDigest: 'after' };
  assert.equal(matchSavedSymbol(target, [moved]), moved);
  assert.equal(matchSavedSymbol(target, [{ ...moved, name: 'different' }]), undefined);
  assert.equal(matchSavedSymbol(target, [{ ...moved, uri: 'file:///b.c' }]), undefined);
});
test('unchanged source permits exact identity but edited ambiguity never guesses', () => {
  const other = { ...target, id: 'file:///a.c#70', start: 70 };
  assert.equal(matchSavedSymbol(target, [target, other]), target);
  assert.equal(matchSavedSymbol(target, [{ ...target, sourceDigest: 'changed' }, other]), undefined);
});
test('locals, fields and header source units keep their identity boundaries', () => {
  const local = { ...target, kind: 'variable' as const, storage: 'local' as const, ownerName: 'owner', containerName: 'Motor', sourceUnitUri: 'file:///unit.c' };
  for (const difference of [{ ownerName: 'other' }, { containerName: 'Sensor' }, { sourceUnitUri: 'file:///other.c' }, { definition: false }])
    assert.equal(matchSavedSymbol(local, [{ ...local, ...difference }]), undefined);
});
