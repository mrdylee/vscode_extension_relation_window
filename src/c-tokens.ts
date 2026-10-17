import { Location } from './model';

export interface CToken {
  text: string; location: Location; space: boolean;
  chain?: { name: string; location: Location }[];
  invocation?: Location;
  hidden?: string[];
  unexpanded?: boolean;
}
export const identifier = /^[A-Za-z_][A-Za-z_0-9]*$/;
// Translation-phase line splicing occurs before comments and tokenization.
export function tokenizeC(source: string, location: (start: number, end: number) => Location): CToken[] {
  let text = ''; const positions: number[] = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\\' && (source[i + 1] === '\n' || source.slice(i + 1, i + 3) === '\r\n')) { i += source[i + 1] === '\r' ? 2 : 1; continue; }
    positions.push(i); text += source[i];
  }
  const pattern = /\s+|\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|(?:u8|u|U|L)?"(?:\\[\s\S]|[^"\\])*"|(?:u|U|L)?'(?:\\[\s\S]|[^'\\])*'|[A-Za-z_][A-Za-z_0-9]*|(?:\d|\.\d)(?:[eEpP][+-]|[A-Za-z_0-9.])*|##|\.\.\.|<<=|>>=|->|\+\+|--|&&|\|\||==|!=|<=|>=|<<|>>|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|[^\s]/gy;
  const tokens: CToken[] = []; let space = false;
  for (const match of text.matchAll(pattern)) {
    if (/^\s|^\/[/\*]/.test(match[0])) { space = true; continue; }
    tokens.push({ text: match[0], location: location(positions[match.index], positions[match.index + match[0].length - 1] + 1), space });
    space = false;
  }
  return tokens;
}
export function joinTokens(tokens: CToken[]) { return tokens.map(token => token.text).join(' '); }
export function locationIn(text: string, uri: string, base = 0) {
  const starts = [0]; for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const point = (offset: number) => {
    let low = 0, high = starts.length;
    while (low + 1 < high) { const mid = (low + high) >>> 1; if (starts[mid] <= offset) low = mid; else high = mid; }
    return { line: low, column: offset - starts[low] };
  };
  return (start: number, end: number): Location => {
    start += base; end += base;
    const a = point(start), b = point(end);
    return { uri, start, end, line: a.line, column: a.column, endLine: b.line, endColumn: b.column };
  };
}
