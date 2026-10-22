import { Node } from 'web-tree-sitter';
import { locationIn, tokenizeC } from './c-tokens';

interface Range { start: number; end: number }
export interface InitializerRecovery {
  directives: Range[];
  inactive: Range[];
  contexts: (Range & { conditions: string[] })[];
  separators: number[];
}

// The C grammar supports directives in declarations, but not initializer lists.
// Recover only balanced conditional groups fully contained in an initializer.
export function initializerPreprocessor(root: Node, text: string, skipInactive: boolean, validCondition: (condition: string) => boolean): InitializerRecovery {
  const result: InitializerRecovery = { directives: [], inactive: [], contexts: [], separators: [] };
  const lists: Range[] = [], protectedRanges: Range[] = [], pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.type === 'initializer_list' && node.hasError) lists.push({ start: node.startIndex, end: node.endIndex });
    else if (['preproc_def', 'preproc_function_def', 'preproc_include', 'preproc_call'].includes(node.type)) protectedRanges.push({ start: node.startIndex, end: node.endIndex });
    else pending.push(...node.namedChildren);
  }
  if (!text.includes('#')) return result;
  const tokens = tokenizeC(text, locationIn(text, ''));
  const hashes = new Set(tokens.filter(token => token.text === '#').map(token => token.location.start));
  // Positional initializers can be damaged so badly that the grammar loses
  // the list node altogether. Balanced braces after '=' still delimit it.
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i - 1].text !== '=' || tokens[i].text !== '{') continue;
    if (protectedRanges.some(range => tokens[i].location.start >= range.start && tokens[i].location.start < range.end)) continue;
    let depth = 1, end = i + 1;
    for (; end < tokens.length; end++) {
      if (tokens[end].text === '{') depth++;
      if (tokens[end].text === '}' && --depth === 0) break;
    }
    if (end < tokens.length) lists.push({ start: tokens[i].location.start, end: tokens[end].location.end });
  }
  lists.sort((a, b) => a.start - b.start || b.end - a.end);
  let covered = -1;
  for (const list of lists) {
    if (list.start < covered) continue;
    covered = list.end;
    const local: InitializerRecovery = { directives: [], inactive: [], contexts: [], separators: [] };
    const stack: { excluded: boolean; conditions: string[]; previous: string[]; possible: boolean; seenElse: boolean }[] = [];
    let cursor = list.start, valid = true;
    let tokenCursor = tokens.findIndex(token => token.location.start >= list.start);
    const segment = (end: number) => {
      if (stack.some(frame => frame.excluded)) local.inactive.push({ start: cursor, end });
      else if (stack.length) local.contexts.push({ start: cursor, end, conditions: stack.flatMap(frame => frame.conditions) });
    };
    for (const match of text.slice(list.start, list.end).matchAll(/^[\t ]*#[\t ]*(\w+)((?:[^\n]*\\\r?\n)*[^\n]*(?:\n|$))/gm)) {
      const start = list.start + match.index, hash = start + match[0].indexOf('#');
      if (!hashes.has(hash)) continue;
      const end = start + match[0].length, directive = match[1];
      const tokenStart = tokenCursor;
      while (tokenCursor < tokens.length && tokens[tokenCursor].location.start < start) tokenCursor++;
      const content = tokens.slice(tokenStart, tokenCursor);
      while (tokenCursor < tokens.length && tokens[tokenCursor].location.start < end) tokenCursor++;
      // Directives inside a scalar expression need expression-level variants;
      // flattening those into initializer entries changes their meaning.
      if (content.filter(token => token.text === '(').length !== content.filter(token => token.text === ')').length ||
        content.filter(token => token.text === '[').length !== content.filter(token => token.text === ']').length) { valid = false; break; }
      const excluded = stack.some(frame => frame.excluded);
      segment(start);
      const condition = tokenizeC(match[2], locationIn(match[2], '')).map(token => token.text).join(' ');
      const label = `#${directive}${condition ? ' ' + condition : ''}`;
      if ((['if', 'elif'].includes(directive) && !validCondition(condition)) ||
        (['ifdef', 'ifndef'].includes(directive) && !/^[A-Za-z_]\w*$/.test(condition))) { valid = false; break; }
      let literal = condition.replace(/\s/g, '');
      while (literal.startsWith('(') && literal.endsWith(')')) literal = literal.slice(1, -1);
      const value = skipInactive && ['if', 'elif'].includes(directive) ? /^0[uUlL]*$/.test(literal) ? false : /^1[uUlL]*$/.test(literal) ? true : undefined : undefined;
      if (['if', 'ifdef', 'ifndef'].includes(directive) && condition) {
        stack.push({ excluded: value === false, conditions: value === undefined ? [label] : [], previous: value === undefined ? [`else of ${label}`] : [], possible: value !== true, seenElse: false });
      } else if (['else', 'elif'].includes(directive)) {
        const frame = stack.at(-1);
        if (!frame || frame.seenElse || (directive === 'else' ? !!condition : !condition)) { valid = false; break; }
        frame.excluded = !frame.possible || value === false;
        frame.conditions = [...frame.previous, ...(directive === 'elif' && value === undefined ? [label] : [])];
        if (value === undefined && directive === 'elif') frame.previous.push(`else of ${label}`);
        if (value === true) frame.possible = false;
        if (directive === 'else') frame.seenElse = true;
      } else if (directive === 'endif' && !condition && stack.length) stack.pop();
      else { valid = false; break; }
      // Alternative final entries may legally omit their trailing comma. A
      // separator prevents `.cb=a` and `.cb=b` becoming `.cb=a.cb=b`.
      const last = content.at(-1)?.text;
      if (['else', 'elif'].includes(directive) && !excluded && !stack.some(frame => frame.excluded) &&
        last && (/^(?:[A-Za-z_0-9'\"]|\.\d)/.test(last) || [')', ']', '}', '++', '--'].includes(last))) local.separators.push(start);
      local.directives.push({ start, end }); cursor = end;
    }
    if (!valid || stack.length || !local.directives.length) continue;
    segment(list.end);
    // Bound the whole-initializer alternatives to the same 32 variants used
    // by macro expansion. Larger cases retain their original diagnostics.
    const conditions = new Set(local.contexts.flatMap(range => range.conditions.map(label => label.replace(/^else of /, ''))));
    if (conditions.size > 5) continue;
    result.directives.push(...local.directives); result.inactive.push(...local.inactive); result.contexts.push(...local.contexts); result.separators.push(...local.separators);
  }
  return result;
}
