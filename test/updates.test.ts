import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectRelease, UpdateChecker, CHECK_INTERVAL, REPOSITORY_URL, type UpdateHost } from '../src/updates';

const latest = (version = '0.2.0') => ({ tag_name: `v${version}`, body: '변수 분석 개선', draft: false, prerelease: false,
  assets: [{ name: `c-relation-explorer-${version}.vsix`, size: 200,
    browser_download_url: `${REPOSITORY_URL}/releases/download/v${version}/c-relation-explorer-${version}.vsix` }] });
function fixture() {
  const calls: string[] = []; let last = 0;
  const host: UpdateHost = {
    currentVersion: '0.1.9', now: () => CHECK_INTERVAL * 2, lastCheck: () => last,
    saveCheck: async time => { last = time; }, latest: async () => { calls.push('fetch'); return latest(); },
    confirm: async () => { calls.push('confirm'); return false; },
    install: async () => { calls.push('install'); }, inform: async (_message, error) => { calls.push(error ? 'error' : 'info'); }
  };
  return { host, calls, checker: new UpdateChecker(host) };
}
test('release selection uses numeric stable versions and only the expected repository asset', () => {
  assert.equal(selectRelease(latest('0.1.10'), '0.1.9')?.version, '0.1.10');
  for (const release of [latest('0.1.9'), latest('0.1.8'), {...latest(), draft:true}, {...latest(), prerelease:true}, latest('0.2.0-beta.1')])
    assert.equal(selectRelease(release, '0.1.9'), undefined);
  assert.throws(() => selectRelease({...latest(), assets: []}, '0.1.9'));
  const foreign = latest(); foreign.assets[0].browser_download_url='https://example.com/update.vsix';
  assert.throws(() => selectRelease(foreign, '0.1.9'));
  const wrong = latest(); wrong.assets[0].name='another-extension.vsix';
  assert.throws(() => selectRelease(wrong, '0.1.9'));
});
test('automatic checks are daily and dismissal never downloads or installs', async () => {
  const f=fixture(); assert.equal(await f.checker.check(), 'declined');
  assert.deepEqual(f.calls, ['fetch','confirm']);
  assert.equal(await f.checker.check(), 'throttled');
  await f.checker.check(true);
  assert.deepEqual(f.calls, ['fetch','confirm','fetch','confirm']);
  f.host.now=()=>CHECK_INTERVAL*3;
  await f.checker.check(); assert.equal(f.calls.filter(c=>c==='fetch').length,3);
});
test('only explicit acceptance installs and the installed version is not offered again', async () => {
  const f=fixture(); f.host.confirm=async()=>{f.calls.push('confirm');return true;};
  assert.equal(await f.checker.check(), 'installed');
  assert.deepEqual(f.calls,['fetch','confirm','install']);
  assert.equal(await f.checker.check(true),'current');
  assert.equal(f.calls.filter(c=>c==='install').length,1);
});
test('missing releases and equal versions stay quiet automatically and explain manual results', async () => {
  const f=fixture(); f.host.latest=async()=>undefined;
  assert.equal(await f.checker.check(),'unavailable'); assert.deepEqual(f.calls,[]);
  await f.checker.check(true); assert.deepEqual(f.calls,['info']);
  f.host.latest=async()=>latest('0.1.9'); await f.checker.check(true);
  assert.deepEqual(f.calls,['info','info']);
});
test('automatic network errors are quiet, manual and approved-install errors are reported', async () => {
  const f=fixture(); f.host.latest=async()=>{throw new Error('offline');};
  assert.equal(await f.checker.check(),'failed'); assert.deepEqual(f.calls,[]);
  await f.checker.check(true); assert.deepEqual(f.calls,['error']);
  f.host.latest=async()=>latest(); f.host.confirm=async()=>true;
  f.host.install=async()=>{throw new Error('install failed');};
  f.host.now=()=>CHECK_INTERVAL*3;
  assert.equal(await f.checker.check(),'failed'); assert.deepEqual(f.calls,['error','error']);
});
test('overlapping checks cannot open duplicate prompts or installations', async () => {
  const f=fixture(); let finish!: (answer:boolean)=>void;
  f.host.confirm=()=>new Promise(resolve=>{finish=resolve;});
  const pending=f.checker.check();
  while(!finish) await new Promise(resolve=>setImmediate(resolve));
  assert.equal(await f.checker.check(true),'busy');
  finish(false); await pending;
  assert.deepEqual(f.calls,['fetch']);
});

test('release fetch distinguishes absence, HTTP failures and malformed responses', async () => {
  const { fetchLatestRelease, RELEASE_API } = await import('../src/updates');
  const mock = (body: string, status = 200) => (async (url: unknown, init: RequestInit) => {
    assert.equal(url, RELEASE_API); assert.ok(init.signal);
    return new Response(body, {status});
  }) as typeof fetch;
  assert.equal(await fetchLatestRelease(mock('',404)), undefined);
  await assert.rejects(fetchLatestRelease(mock('',403)), /403/);
  await assert.rejects(fetchLatestRelease(mock('not json')));
  await assert.rejects(fetchLatestRelease(mock(' '.repeat(2 * 1024 * 1024 + 1))), /size limit/);
  assert.deepEqual(await fetchLatestRelease(mock(JSON.stringify(latest()))), latest());
});

test('download verifies size and digest before returning installation bytes', async () => {
  const { downloadRelease } = await import('../src/updates');
  const { createHash } = await import('node:crypto');
  const bytes=Buffer.from('test VSIX bytes');
  const release=selectRelease(latest(),'0.1.9')!;
  release.size=bytes.length; release.digest='sha256:'+createHash('sha256').update(bytes).digest('hex');
  const fetcher=(async (url: unknown, init: RequestInit) => {
    assert.equal(url,release.downloadUrl); assert.ok(init.signal);
    return new Response(bytes);
  }) as typeof fetch;
  assert.deepEqual(await downloadRelease(release,fetcher),bytes);
  await assert.rejects(downloadRelease({...release,size:bytes.length+1},fetcher),/size/);
  await assert.rejects(downloadRelease({...release,digest:'sha256:'+'0'.repeat(64)},fetcher),/checksum/);
});
