import { BuildFileSystem } from '../src/build-context';

export function buildFixture(files: Record<string, string>) {
  const texts = new Map(Object.entries(files).map(([name, text]) => [new URL(name, 'file:///p/').href, text]));
  const reads: string[] = [], lists: string[] = [];
  const fs: BuildFileSystem = {
    async readText(uri) { reads.push(uri); return texts.get(uri); },
    async list(uri) {
      lists.push(uri); const prefix = uri.replace(/\/$/, '') + '/', entries = new Map<string, 'file' | 'directory'>();
      for (const name of texts.keys()) if (name.startsWith(prefix)) {
        const rest = name.slice(prefix.length), slash = rest.indexOf('/');
        entries.set(prefix + (slash < 0 ? rest : rest.slice(0, slash)), slash < 0 ? 'file' : 'directory');
      }
      return [...entries].map(([uri, kind]) => ({ uri, kind }));
    }
  };
  return { fs, texts, reads, lists };
}
