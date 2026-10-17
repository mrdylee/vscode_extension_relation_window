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
  if (!value || typeof value !== 'object') throw new Error('릴리스 응답을 읽을 수 없습니다.');
  const data = value as Record<string, unknown>;
  if (data.draft || data.prerelease || typeof data.tag_name !== 'string') return undefined;
  const next = versionParts(data.tag_name), installed = versionParts(current);
  if (!next || !installed) return undefined;
  const different = next.findIndex((part, i) => part !== installed[i]);
  if (different < 0 || next[different] < installed[different]) return undefined;
  const version = next.join('.'), filename = `c-relation-explorer-${version}.vsix`;
  const downloadUrl = `${REPOSITORY_URL}/releases/download/${data.tag_name}/${filename}`;
  const asset = Array.isArray(data.assets) ? data.assets.find(a => a?.name === filename) : undefined;
  if (!asset || asset.browser_download_url !== downloadUrl || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_VSIX_BYTES)
    throw new Error(`v${version} 릴리스에 올바른 ${filename} 설치 파일이 없습니다.`);
  if (asset.digest != null && !/^sha256:[a-f0-9]{64}$/i.test(asset.digest)) throw new Error('설치 파일의 체크섬 형식이 올바르지 않습니다.');
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
      await this.host.saveCheck(now);
      const value = await this.host.latest();
      if (value === undefined) {
        if (manual) await this.host.inform('아직 게시된 정식 릴리스가 없습니다.');
        return 'unavailable';
      }
      const release = selectRelease(value, this.current);
      if (!release) {
        if (manual) await this.host.inform(`현재 v${this.current}보다 새로운 정식 버전이 없습니다.`);
        return 'current';
      }
      approved = await this.host.confirm(release);
      if (!approved) return 'declined';
      await this.host.install(release);
      this.current = release.version;
      return 'installed';
    } catch (error) {
      if (manual || approved) await this.host.inform(`업데이트 ${approved ? '설치' : '확인'} 실패: ${error instanceof Error ? error.message : String(error)}`, true);
      return 'failed';
    } finally { this.busy = false; }
  }
}

async function readResponse(response: Response, limit: number): Promise<Buffer> {
  if (!response.ok) throw new Error(`GitHub 응답: HTTP ${response.status}`);
  if (!response.body) throw new Error('다운로드 응답이 비어 있습니다.');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('다운로드 크기 제한을 초과했습니다.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export async function fetchLatestRelease(fetcher: typeof fetch = fetch) {
  const response = await fetcher(RELEASE_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'C-Relation-Explorer' }, signal: AbortSignal.timeout(10000) });
  if (response.status === 404) return undefined;
  return JSON.parse((await readResponse(response, 2 * 1024 * 1024)).toString('utf8'));
}

export async function downloadRelease(release: Release, fetcher: typeof fetch = fetch): Promise<Buffer> {
  const response = await fetcher(release.downloadUrl, { signal: AbortSignal.timeout(60000) });
  const bytes = await readResponse(response, MAX_VSIX_BYTES);
  if (bytes.length !== release.size) throw new Error('설치 파일 크기가 릴리스 정보와 일치하지 않습니다.');
  if (release.digest && `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== release.digest.toLowerCase())
    throw new Error('설치 파일 체크섬이 일치하지 않습니다.');
  return bytes;
}
