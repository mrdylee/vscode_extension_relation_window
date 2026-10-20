import { mkdir, readdir, rename, rm, open, lstat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const segmentBytes = 256 * 1024;
const sessionPattern = /^(\d{8}T\d{6}-[\w-]+)(?:\.1)?\.jsonl$/;
const errorCode = (error: unknown) => (error as NodeJS.ErrnoException)?.code ?? 'unavailable';
const fenced = (text: string) => '```text\n' + text.replace(/`/g, "'") + '\n```';
async function tail(file: string, bytes: number) {
  const info = await lstat(file);
  if (!info.isFile()) throw Object.assign(new Error('Not a regular file'), { code: 'UNSUPPORTED' });
  const handle = await open(file, 'r');
  try {
    const size = (await handle.stat()).size, start = Math.max(0, size - bytes), buffer = Buffer.alloc(Math.min(size, bytes));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    return { text: start ? text.slice(text.indexOf('\n') + 1) : text, truncated: start > 0 };
  } finally { await handle.close(); }
}

/** Best-effort bounded journal. Pending asynchronous writes can be lost on abrupt exit. */
export class DiagnosticHistory {
  private pending: string[] = [];
  private writing?: Promise<void>;
  private ready: Promise<void>;
  private bytes = 0;
  private failure?: string;
  dropped = 0;
  readonly session: string;
  constructor(private directory: string | undefined, session = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + '-' + Date.now() + '-' + randomUUID()) {
    this.session = session;
    this.ready = this.initialize().catch(error => { this.failure = errorCode(error); });
  }
  private async initialize() {
    if (!this.directory) { this.failure = 'workspace storage unavailable'; return; }
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const files = (await readdir(this.directory)).filter(name => sessionPattern.test(name));
    const sessions = [this.session, ...[...new Set(files.map(name => name.match(sessionPattern)![1]))].filter(name => name !== this.session).sort().reverse()];
    for (const file of files) if (!sessions.slice(0, 3).includes(file.match(sessionPattern)![1])) await rm(path.join(this.directory, file), { force: true });
    try { this.bytes = (await lstat(path.join(this.directory, this.session + '.jsonl'))).size; } catch { /* New session. */ }
  }
  record(entry: object) {
    if (this.failure) return;
    const line = JSON.stringify(entry) + '\n';
    if (Buffer.byteLength(line) > 16 * 1024) { this.dropped++; return; }
    if (this.pending.length >= 64) { this.pending.shift(); this.dropped++; }
    this.pending.push(line);
    this.start();
  }
  private start() {
    if (!this.writing) this.writing = this.drain().finally(() => {
      this.writing = undefined;
      if (this.pending.length) this.start();
    });
  }
  private async drain() {
    await this.ready;
    if (this.failure || !this.directory) { this.pending = []; return; }
    const file = path.join(this.directory, this.session + '.jsonl');
    try {
      while (this.pending.length) {
        const line = this.pending.shift()!, length = Buffer.byteLength(line);
        if (this.bytes + length > segmentBytes) {
          await rm(path.join(this.directory, this.session + '.1.jsonl'), { force: true });
          await rename(file, path.join(this.directory, this.session + '.1.jsonl')); this.bytes = 0;
        }
        const handle = await open(file, 'a', 0o600);
        try { await handle.writeFile(line); } finally { await handle.close(); }
        this.bytes += length;
      }
    } catch (error) { this.failure = errorCode(error); this.pending = []; }
  }
  async flush() { await this.ready; while (this.writing) await this.writing; }
  async read() {
    await this.ready;
    if (this.failure || !this.directory) return `Diagnostic history unavailable: ${this.failure}.`;
    const files = (await readdir(this.directory)).filter(name => sessionPattern.test(name)).sort().reverse().slice(0, 6);
    const sections = [`History: up to three sessions, two 256 KiB segments each; last 16 KiB per segment below. Records dropped by queue/size limits this session: ${this.dropped}. Report collection does not wait for pending writes; abrupt exit can lose unsaved records.`];
    for (const file of files) {
      try { const result = await tail(path.join(this.directory, file), 16 * 1024); sections.push(`Session ${file}${result.truncated ? ' (tail only)' : ''}\n${fenced(result.text)}`); }
      catch (error) { sections.push(`Session ${file}: unavailable (${errorCode(error)}).`); }
    }
    return sections.join('\n\n');
  }
}

/** VS Code's log layout is internal: fail explicitly rather than searching arbitrary folders. */
export async function collectHostLogs(logPath: string | undefined, redactions: string[] = []): Promise<string> {
  if (!logPath) return 'Host logs unavailable: no local log directory.';
  const host = path.dirname(logPath), parent = path.dirname(host);
  if (!/^exthost\d*$/.test(path.basename(host))) return 'Host logs unavailable: unsupported log directory layout.';
  const window = /^window\d+$/.test(path.basename(parent)) ? path.basename(parent) : undefined;
  const current = window ? path.dirname(parent) : parent;
  if (!/^\d{8}T\d{6}$/.test(path.basename(current))) return 'Host logs unavailable: unsupported session directory layout.';
  try {
    const roots = [current];
    const previous = (await readdir(path.dirname(current), { withFileTypes: true })).filter(entry => entry.isDirectory() && /^\d{8}T\d{6}$/.test(entry.name) && entry.name < path.basename(current)).map(entry => entry.name).sort().at(-1);
    if (previous) roots.push(path.join(path.dirname(current), previous));
    const files = [path.join(host, 'exthost.log')];
    for (const root of roots) {
      files.push(path.join(root, 'remoteagent.log'));
      const container = window ? path.join(root, window) : root;
      try {
        const hosts = (await readdir(container, { withFileTypes: true })).filter(entry => entry.isDirectory() && /^exthost\d*$/.test(entry.name)).map(entry => entry.name).sort().reverse().slice(0, 3);
        files.push(...hosts.map(name => path.join(container, name, 'exthost.log')));
      } catch { /* Missing previous-window directory is reported by the remaining sources. */ }
    }
    const sections = ['Host excerpts: selected lifecycle/OOM lines from bounded log tails; not a complete crash dump. Saved history uses UTC; host timestamps keep their original format. Review before sharing: metadata may remain. Previous sessions may belong to another window/workspace. Windows-side Window logs are not collected from WSL.'];
    const relevant = /Extension Host Process|Extension host with pid|ExtensionHostConnection|heap out of memory|FATAL ERROR|SIG(?:KILL|ABRT|SEGV)|oom-kill|out of memory|Last few GCs|Mark-Compact|Scavenge|unresponsive|vscode\.lock|_doActivateExtension dylee\.dynsight/i;
    for (const file of [...new Set(files)].slice(0, 8)) {
      const label = path.relative(path.dirname(current), file).replace(/\\/g, '/');
      try {
        const result = await tail(file, 64 * 1024);
        let excerpt = result.text.split('\n').filter(line => relevant.test(line)).slice(-120).map(line => line.slice(0, 1500)).join('\n');
        excerpt = excerpt.replace(/https?:\/\/[^\s"'<>]+/g, '<redacted-url>');
        for (const root of redactions.filter(Boolean).sort((a, b) => b.length - a.length)) excerpt = excerpt.split(root).join('<redacted-path>');
        sections.push(`${label}${result.truncated ? ' (last 64 KiB only)' : ''}:\n${excerpt ? fenced(excerpt) : 'No matching lifecycle/OOM lines in the captured tail.'}`);
      } catch (error) { sections.push(`${label}: ${errorCode(error) === 'ENOENT' ? 'missing' : 'unavailable (' + errorCode(error) + ')'}.`); }
    }
    return sections.join('\n\n');
  } catch (error) { return `Host logs unavailable (${errorCode(error)}).`; }
}
