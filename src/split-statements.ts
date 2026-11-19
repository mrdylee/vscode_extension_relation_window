import { Node } from 'web-tree-sitter';

export interface SplitStatement {
  shared: Node;
  sharedAlternative?: Node;
  embedded?: boolean;
  trailing?: Node[];
  headers: Map<number, 'body' | 'else'>;
  errors: Set<number>;
}
const conditional = new Set(['preproc_if', 'preproc_elif', 'preproc_ifdef', 'preproc_elifdef']);

// Tree-sitter may invent an empty if body before #endif, or detach a trailing
// else. Bind only those exact fragments to the next complete source statement.
export function splitStatement(group: Node, shared: Node | undefined): SplitStatement | undefined {
  // With a trailing C else, the grammar can swallow the real #endif into the
  // last if header and attach the shared body there, inventing a later #endif.
  if (conditional.has(group.type) && group.children.some(child => child.type === '#endif' && child.isMissing)) {
    let last = group.childForFieldName('alternative');
    while (last?.childForFieldName('alternative')) last = last.childForFieldName('alternative');
    const header = last?.namedChildren.filter(child => child.type !== 'comment');
    const terminal = header?.[0]?.type === 'if_statement' ? header[0] : undefined;
    const trailing = header?.slice(1) ?? [];
    const body = terminal?.childForFieldName('consequence'), otherwise = terminal?.childForFieldName('alternative');
    const test = terminal?.childForFieldName('condition');
    const errors = terminal?.namedChildren.filter(child => child.type === 'ERROR') ?? [];
    if (body && !body.hasError && otherwise && !otherwise.hasError && test && !test.hasError && !trailing.some(node=>node.hasError) &&
      errors.length === 1 && /^#\s*endif\s*$/.test(errors[0].text) && errors[0].startIndex >= test.endIndex && errors[0].endIndex <= body.startIndex) {
      const result: SplitStatement = {shared: body, sharedAlternative: otherwise, embedded: true, trailing, headers: new Map([[terminal!.id, 'body']]),
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
