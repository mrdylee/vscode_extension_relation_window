import { Node } from 'web-tree-sitter';

export interface SplitStatement {
  shared: Node;
  sharedAlternative?: Node;
  embeddedEndif?: Node;
  trailing?: Node[];
  headers: Map<number, 'body' | 'else'>;
  errors: Set<number>;
}
const conditional = new Set(['preproc_if', 'preproc_elif', 'preproc_ifdef', 'preproc_elifdef']);

// Unknown macros are not assumed undefined: the source folder has no build configuration.
export function literalCondition(node: Node): boolean | undefined {
  let text = node.text.replace(/\s/g, '');
  while (text.startsWith('(') && text.endsWith(')')) text = text.slice(1, -1);
  if (/^0(?:[uUlL]*)$/.test(text)) return false;
  if (/^1(?:[uUlL]*)$/.test(text)) return true;
  return undefined;
}

// Tree-sitter may invent an empty if body before #endif, or detach a trailing
// else. Bind only those exact fragments to the next complete source statement.
export function splitStatement(group: Node, shared: Node | undefined): SplitStatement | undefined {
  // With a trailing C else, the grammar can swallow the real #endif into the
  // last if header and attach the shared body there, inventing a later #endif.
  if (conditional.has(group.type) && group.children.some(child => child.type === '#endif' && child.isMissing)) {
    let last = group.childForFieldName('alternative');
    while (last?.childForFieldName('alternative')) last = last.childForFieldName('alternative');
    const lastCondition = last?.childForFieldName('condition');
    // A final literal-true elif covers the remaining configurations just like else.
    const exhaustive = last?.type === 'preproc_else' || (lastCondition && literalCondition(lastCondition) === true);
    const header = exhaustive ? last!.namedChildren.filter(child => child.type !== 'comment' && child.id !== lastCondition?.id) : undefined;
    const terminal = header?.[0]?.type === 'if_statement' ? header[0] : undefined;
    const trailing = header?.slice(1) ?? [];
    const body = terminal?.childForFieldName('consequence'), otherwise = terminal?.childForFieldName('alternative');
    const test = terminal?.childForFieldName('condition');
    const errors = terminal?.namedChildren.filter(child => child.type === 'ERROR') ?? [];
    if (body && !body.hasError && otherwise && !otherwise.hasError && test && !test.hasError && !trailing.some(node=>node.hasError) &&
      errors.length === 1 && /^#\s*endif\s*$/.test(errors[0].text) && errors[0].startIndex >= test.endIndex && errors[0].endIndex <= body.startIndex) {
      const result: SplitStatement = {shared: body, sharedAlternative: otherwise, embeddedEndif: errors[0], trailing, headers: new Map([[terminal!.id, 'body']]),
        errors: new Set([errors[0].id, ...group.children.filter(child => child.type === '#endif' && child.isMissing).map(child => child.id)])};
      function prefix(node: Node): boolean {
        if (node.id === last!.id) return true;
        const condition = node.childForFieldName('condition') ?? node.childForFieldName('name'), alternative = node.childForFieldName('alternative');
        const children = node.namedChildren.filter(child => child.id !== condition?.id && child.id !== alternative?.id && child.type !== 'comment');
        const before = children[0], empty = before?.childForFieldName('consequence');
        if (children.length !== 1 || before.type !== 'if_statement' || before.childForFieldName('alternative') ||
          !before.childForFieldName('condition') || before.childForFieldName('condition')!.hasError ||
          empty?.type !== 'expression_statement' || empty.text.trim() || empty.namedChildren.length || !alternative) return false;
        result.headers.set(before.id, 'body'); empty.children.filter(child => child.isMissing).forEach(child => result.errors.add(child.id));
        return prefix(alternative);
      }
      if (prefix(group)) return result;
    }
  }
  if (!conditional.has(group.type) || !group.children.some(child => child.type === '#endif' && !child.isMissing) || !shared || shared.hasError ||
    !['compound_statement', 'expression_statement', 'return_statement', 'if_statement', 'for_statement', 'while_statement', 'do_statement', 'switch_statement'].includes(shared.type)) return;
  const result: SplitStatement = {shared, headers: new Map(), errors: new Set()};
  function branch(node: Node): boolean {
    const condition = node.childForFieldName('condition') ?? node.childForFieldName('name');
    const alternative = node.childForFieldName('alternative');
    const children = node.namedChildren.filter(child => child.id !== condition?.id && child.id !== alternative?.id && child.type !== 'comment');
    const header = children[0], tail = children[1];
    if (header?.type === 'if_statement') {
      const test = header.childForFieldName('condition'), body = header.childForFieldName('consequence');
      if (!test || test.hasError || !body || header.childForFieldName('alternative')) return false;
      if (children.length === 1 && body.type === 'expression_statement' && !body.text.trim() && !body.namedChildren.length) {
        result.headers.set(header.id, 'body'); body.children.filter(child => child.isMissing).forEach(child => result.errors.add(child.id));
      }
      else if (children.length === 2 && tail.type === 'ERROR' && tail.text.trim() === 'else' && !body.hasError) {
        result.headers.set(header.id, 'else'); result.errors.add(tail.id);
      } else return false;
    } else if (children.length !== 1 || !conditional.has(header?.type) || !branch(header)) return false;
    return !alternative || branch(alternative);
  }
  return branch(group) ? result : undefined;
}

// Prune literal branches before reparsing, while keeping the shared body and
// all source offsets intact. Macro expansion reuses the same inactive ranges.
export function inactiveSplitHeaders(group: Node) {
  const ranges: {start: number; end: number}[] = [];
  const split = splitStatement(group, undefined), endif = split?.embeddedEndif;
  if (!endif) return ranges;
  let keptUnknown = false;
  for (let branch: Node | null = group; branch; branch = branch.childForFieldName('alternative')) {
    const condition = branch.childForFieldName('condition'), next = branch.childForFieldName('alternative');
    const value = branch.type === 'preproc_else' ? true : condition ? literalCondition(condition) : undefined;
    if (value === false && next) {
      ranges.push({start: branch.startIndex, end: next.startIndex});
    } else if (value === true) {
      if (!keptUnknown) {
        const header = branch.namedChildren.find(child => split.headers.has(child.id))!;
        return [{start: group.startIndex, end: header.startIndex},
          {start: header.childForFieldName('condition')!.endIndex, end: endif.endIndex}];
      }
      if (next) ranges.push({start: next.startIndex, end: endif.startIndex});
      break;
    } else {
      if (!keptUnknown && branch.id !== group.id) {
        // Promote the first surviving #elif to #if by blanking only 'el'.
        const keyword = branch.firstChild!, start = keyword.startIndex + keyword.text.indexOf('elif');
        ranges.push({start, end: start + 2});
      }
      keptUnknown = true;
    }
  }
  return ranges;
}

export function hasUnsupportedSyntax(root: Node) {
  if (!root.hasError) return false;
  const ignored = new Set<number>(), nodes: Node[] = [], pending = [root];
  while (pending.length) {
    const node = pending.pop()!; nodes.push(node); pending.push(...node.children);
    if (node.type !== 'compound_statement') continue;
    const children = node.namedChildren.filter(child => child.type !== 'comment');
    for (let n = 0; n < children.length; n++) splitStatement(children[n], children[n + 1])?.errors.forEach(id => ignored.add(id));
  }
  return nodes.some(node => (node.type === 'ERROR' || node.isMissing) && !ignored.has(node.id));
}
