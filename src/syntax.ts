export type SyntaxKind = 'plain' | 'keyword' | 'type' | 'function' | 'variable' | 'macro' | 'number' | 'string' | 'comment' | 'preprocessor';
export interface SyntaxToken { text: string; kind: SyntaxKind }
const keywords = new Set('auto break case const continue default do else enum extern for goto if inline register restrict return sizeof static struct switch typedef union volatile while _Alignas _Alignof _Atomic _Generic _Noreturn _Static_assert _Thread_local'.split(' '));
const types = new Set('void char short int long float double signed unsigned _Bool _Complex _Imaginary bool size_t ptrdiff_t'.split(' '));

// Lexical highlighting only; arbitrary typedefs and expanded macros need semantic analysis.
export function highlightC(text: string): SyntaxToken[][] {
  const lines: SyntaxToken[][] = [[]];
  const pattern = /\/\*[\s\S]*?(?:\*\/|(?![\s\S]))|\/\/[^\n]*|(?:u8|[LuU])?"(?:\\[\s\S]|[^"\\])*"|(?:[LuU])?'(?:\\[\s\S]|[^'\\])*'|^[ \t]*#[ \t]*[A-Za-z_]+|\b(?:0[xX][\da-fA-F]+|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)[uUlLfF]*|[A-Za-z_]\w*|[ \t\r]+|\n|[^]/gm;
  for (const match of text.matchAll(pattern)) {
    const value = match[0];
    let kind: SyntaxKind = 'plain';
    if (value.startsWith('/*') || value.startsWith('//')) kind = 'comment';
    else if (/^(?:u8|[LuU])?["']/.test(value)) kind = 'string';
    else if (/^\s*#/.test(value)) kind = 'preprocessor';
    else if (/^\d/.test(value)) kind = 'number';
    else if (/^[A-Za-z_]\w*$/.test(value)) {
      if (types.has(value) || /_t$/.test(value)) kind = 'type';
      else if (keywords.has(value)) kind = 'keyword';
      else if (/^[A-Z_][A-Z_\d]*$/.test(value)) kind = 'macro';
      else if (/^\s*\(/.test(text.slice(match.index! + value.length))) kind = 'function';
      else kind = 'variable';
    }
    value.split('\n').forEach((part, i) => {
      if (i) lines.push([]);
      if (part) lines[lines.length - 1].push({ text: part, kind });
    });
  }
  return lines;
}
