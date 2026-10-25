import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverBuildEntries } from '../src/build-discovery';
import { buildFixture } from './build-fixtures';

test('all module ancestors are inspected once without unrelated subtree traversal', async () => {
  const f = buildFixture({ 'build.bat': 'make -f Makefile', Makefile: 'include App/motor/module.mk App/battery/module.mk',
    'App/motor/module.mk': 'SOURCES += App/motor/src/a.c', 'App/motor/options.mk': 'CFLAGS += -DMOTOR',
    'App/battery/module.mk': 'SOURCES += App/battery/src/b.c', 'Unrelated/deep/build.mk': 'CFLAGS=-DWRONG' });
  const result = await discoverBuildEntries(f.fs, { rootUri: 'file:///p', sourceUris: ['file:///p/App/motor/src/a.c', 'file:///p/App/motor/src/other.c', 'file:///p/App/battery/src/b.c'] });
  assert.ok(result.candidates.includes('file:///p/App/motor/options.mk'));
  assert.ok(result.candidates.includes('file:///p/App/battery/module.mk'));
  assert.ok(result.entries.some(e => e.entryUri === 'file:///p/build.bat'));
  assert.equal(f.lists.filter(u => u === 'file:///p/App/motor/src').length, 1);
  assert.ok(!f.lists.some(u => u.includes('Unrelated'))); assert.ok(!f.lists.includes('file:///'));
});
test('roots, root-only discovery, cancellation and explicit nested entry are bounded', async () => {
  const f = buildFixture({ Makefile: '', 'tools/build.sh': 'make', 'other/Makefile': '' });
  const result = await discoverBuildEntries(f.fs, { rootUri: 'file:///p', sourceUris: ['file:///p2/out.c'], explicitEntryUri: 'file:///p/tools/build.sh' });
  assert.ok(result.entries.some(e => e.entryUri.endsWith('/tools/build.sh')));
  assert.ok(!f.lists.some(u => u.startsWith('file:///p2')));
  const cancelled = await discoverBuildEntries(f.fs, { rootUri: 'file:///p', sourceUris: [] }, () => true);
  assert.ok(cancelled.issues.some(i => i.code === 'cancelled'));
});
