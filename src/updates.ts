import { createHash } from 'node:crypto';

export const REPOSITORY_URL = 'https://github.com/mrdylee/vscode_extension_relation_window';
export const RELEASE_API = 'https://api.github.com/repos/mrdylee/vscode_extension_relation_window/releases/latest';
export const CHECK_INTERVAL = 24 * 60 * 60 * 1000;
export const MAX_VSIX_BYTES = 32 * 1024 * 1024;
export interface Release { version: string; notes: string; url: string; downloadUrl: string; size: number; digest?: string }
function versionParts(value: string): number[] | undefined {
  if (!/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return undefined;
  const parts = value.replace(/^v/, '').split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : undefined;
}
export function selectRelease(value: unknown, current: string): Release | undefined {
  if (!value || typeof value !== 'object') throw new Error('Cannot read the release response.');
  const data = value as Record<string, unknown>;
  if (data.draft || data.prerelease || typeof data.tag_name !== 'string') return undefined;
  const next = versionParts(data.tag_name), installed = versionParts(current);
  if (!next || !installed) return undefined;
  const different = next.findIndex((part, i) => part !== installed[i]);
  if (different < 0 || next[different] < installed[different]) return undefined;
  const version = next.join('.'), filename = `dynsight-${version}.vsix`;
  const downloadUrl = `${REPOSITORY_URL}/releases/download/${data.tag_name}/${filename}`;
  const asset = Array.isArray(data.assets) ? data.assets.find(a => a?.name === filename) : undefined;
  if (!asset || asset.browser_download_url !== downloadUrl || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_VSIX_BYTES)
    throw new Error(`Release v${version} does not contain a valid ${filename} asset.`);
  if (asset.digest != null && !/^sha256:[a-f0-9]{64}$/i.test(asset.digest)) throw new Error('The installer checksum format is invalid.');
  return { version, notes: typeof data.body === 'string' ? data.body : '', url: `${REPOSITORY_URL}/releases/tag/${data.tag_name}`,
    downloadUrl, size: asset.size, digest: asset.digest ?? undefined };
}
export interface UpdateHost {
  currentVersion: string; now(): number; lastCheck(): number; saveCheck(time: number): Promise<void>;
  latest(): Promise<unknown | undefined>; confirm(release: Release): Promise<boolean>;
  install(release: Release): Promise<void>; inform(message: string, error?: boolean): Promise<void>;
}
export class UpdateChecker {
  private busy = false;
  private current: string;
  constructor(private host: UpdateHost) { this.current = host.currentVersion; }
  async check(manual = false) {
    if (this.busy) return 'busy';
    const now = this.host.now(), last = this.host.lastCheck();
    if (!manual && last > 0 && now >= last && now - last < CHECK_INTERVAL) return 'throttled';
    this.busy = true;
    let approved = false;
    try {
      const value = await this.host.latest();
      const release = value === undefined ? undefined : selectRelease(value, this.current);
      await this.host.saveCheck(now);
      if (value === undefined) {
        if (manual) await this.host.inform('No stable release has been published yet.');
        return 'unavailable';
      }
      if (!release) {
        if (manual) await this.host.inform(`No stable version newer than v${this.current} is available.`);
        return 'current';
      }
      approved = await this.host.confirm(release);
      if (!approved) return 'declined';
      await this.host.install(release);
      this.current = release.version;
      return 'installed';
    } catch (error) {
      if (manual || approved) await this.host.inform(`Update ${approved ? 'installation' : 'check'} failed: ${error instanceof Error ? error.message : String(error)}`, true);
      return 'failed';
    } finally { this.busy = false; }
  }
}

async function readResponse(response: Response, limit: number): Promise<Buffer> {
  if (!response.ok) throw new Error(`GitHub response: HTTP ${response.status}`);
  if (!response.body) throw new Error('The download response is empty.');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('Download size limit exceeded.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export async function fetchLatestRelease(fetcher: typeof fetch = fetch) {
  const response = await fetcher(RELEASE_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Dynsight' }, signal: AbortSignal.timeout(10000) });
  if (response.status === 404) return undefined;
  return JSON.parse((await readResponse(response, 2 * 1024 * 1024)).toString('utf8'));
}

export async function downloadRelease(release: Release, fetcher: typeof fetch = fetch): Promise<Buffer> {
  const response = await fetcher(release.downloadUrl, { signal: AbortSignal.timeout(60000) });
  const bytes = await readResponse(response, MAX_VSIX_BYTES);
  if (bytes.length !== release.size) throw new Error('Installer size does not match the release metadata.');
  if (release.digest && `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== release.digest.toLowerCase())
    throw new Error('Installer checksum does not match.');
  return bytes;
}
