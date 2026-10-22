import { Node } from 'web-tree-sitter';
import { CType, Location, TypedExpression } from './model';

export function declarator(node: Node): { name?: Node; functionLike: boolean; pointer: boolean } {
  const chain: Node[] = [];
  let current: Node | null = node;
  while (current) {
    chain.push(current);
    if (['identifier', 'type_identifier', 'field_identifier', 'primitive_type'].includes(current.type)) break;
    current = current.childForFieldName('declarator') ??
      (current.type === 'parenthesized_declarator' ? current.namedChildren[0] : null);
  }
  const name = chain.at(-1);
  const wrappers = chain.slice(0, -1).reverse().filter(n => n.type !== 'parenthesized_declarator');
  return {
    name: name && ['identifier', 'type_identifier', 'field_identifier', 'primitive_type'].includes(name.type) ? name : undefined,
    functionLike: wrappers[0]?.type === 'function_declarator',
    pointer: wrappers.some(n => n.type === 'pointer_declarator')
  };
}

export function aggregateId(node: Node, uri: string) {
  const name = node.childForFieldName('name');
  return name ? `${uri}#${name.startIndex}` : `${uri}#${node.startIndex}:aggregate`;
}

// Layers run from the declared identifier outwards: *items[2] is array, pointer.
export function declaredType(declaration: Node, declarator: Node, uri: string): CType | undefined {
  const base = declaration.childForFieldName('type');
  if (!base) return undefined;
  const layers: CType['layers'] = [];
  let node: Node | null = declarator;
  while (node) {
    if (['pointer_declarator', 'abstract_pointer_declarator'].includes(node.type)) layers.unshift('pointer');
    if (['array_declarator', 'abstract_array_declarator'].includes(node.type)) layers.unshift('array');
    if (['function_declarator', 'abstract_function_declarator'].includes(node.type)) layers.unshift('function');
    node = node.childForFieldName('declarator') ?? (['parenthesized_declarator', 'abstract_parenthesized_declarator'].includes(node.type) ? node.namedChildren[0] : null);
  }
  if (['struct_specifier', 'union_specifier', 'enum_specifier'].includes(base.type)) {
    return { name: base.childForFieldName('name')?.text ?? '', tag: base.type.split('_')[0] as CType['tag'],
      id: base.childForFieldName('body') ? aggregateId(base, uri) : undefined, layers };
  }
  return { name: base.text, layers };
}

function writtenType(declaration: Node, target: Node, location: (node: Node) => Location): TypedExpression | undefined {
  const at = location(declaration), type = declaredType(declaration, target, at.uri);
  if (!type) return undefined;
  let block = declaration.parent;
  while (block && !['compound_statement', 'for_statement'].includes(block.type)) block = block.parent;
  return { kind: 'type', type, location: at, scope: block ? { start: block.startIndex, end: block.endIndex } : undefined };
}

export function typedExpression(node: Node, location: (node: Node) => Location, depth = 0): TypedExpression | undefined {
  if (depth >= 32) return undefined;
  if (node.type === 'identifier') return { kind: 'identifier', name: node.text, location: location(node) };
  if (node.type === 'parenthesized_expression') {
    const child = node.namedChildren[0];
    return child && typedExpression(child, location, depth + 1);
  }
  if (['cast_expression', 'compound_literal_expression'].includes(node.type)) {
    const type = node.childForFieldName('type');
    return type ? writtenType(type, type.childForFieldName('declarator') ?? type, location) : undefined;
  }
  if (node.type === 'call_expression') {
    const callee = node.childForFieldName('function');
    const object = callee && typedExpression(callee, location, depth + 1);
    return object ? { kind: 'call', object } : undefined;
  }
  const argument = node.childForFieldName('argument');
  const object = argument && typedExpression(argument, location, depth + 1);
  if (!object) return undefined;
  if (node.type === 'field_expression') {
    const field = node.childForFieldName('field');
    return field ? { kind: 'member', object, name: field.text, arrow: node.childForFieldName('operator')?.text === '->' } : undefined;
  }
  if (node.type === 'subscript_expression') return { kind: 'index', object };
  if (node.type === 'pointer_expression') {
    const operator = node.childForFieldName('operator')?.text;
    if (operator === '*' || operator === '&') return { kind: operator === '*' ? 'dereference' : 'address', object };
  }
  return undefined;
}

function designatorPath(pair: Node, object: TypedExpression | undefined, stop?: Node): TypedExpression | undefined {
  let depth = 0;
  for (const designator of pair.childrenForFieldName('designator')) {
    if (!object || depth++ >= 32) return undefined;
    if (designator.type === 'field_designator') {
      const field = designator.namedChildren[0];
      if (!field) return undefined;
      object = { kind: 'member', object, name: field.text, arrow: false };
    } else if (designator.type === 'subscript_designator') object = { kind: 'index', object, initializer: true };
    else return undefined;
    if (designator.id === stop?.id) return object;
  }
  return object;
}

function initializerTarget(list: Node, location: (node: Node) => Location, depth: number, context?: (node: Node) => string[]): TypedExpression | undefined {
  if (depth >= 32) return undefined;
  const parent = list.parent;
  if (parent?.type === 'init_declarator') {
    const declaration = parent.parent, target = parent.childForFieldName('declarator');
    return declaration && target ? writtenType(declaration, target, location) : undefined;
  }
  if (parent?.type === 'compound_literal_expression') return typedExpression(parent, location, depth + 1);
  if (parent?.type === 'initializer_pair' && parent.parent?.type === 'initializer_list')
    return designatorPath(parent, initializerTarget(parent.parent, location, depth + 1, context));
  if (parent?.type === 'initializer_list') {
    const entries = parent.namedChildren.filter(child => child.type !== 'comment');
    const position = entries.findIndex(child => child.id === list.id);
    const chosen = context?.(list) ?? [], enclosing = context?.(parent) ?? [];
    const preceding = entries.slice(0, position).filter(child => !(context?.(child) ?? []).some(label =>
      chosen.includes(label.startsWith('else of ') ? label.slice(8) : `else of ${label}`)));
    if (preceding.some(child => (context?.(child) ?? []).some(label => !chosen.includes(label) && !enclosing.includes(label)))) return undefined;
    // Designator continuation and scalar brace elision need a C layout cursor;
    // only preceding braced entries safely correspond to whole elements.
    if (position < 0 || preceding.some(child => child.type !== 'initializer_list')) return undefined;
    const object = initializerTarget(parent, location, depth + 1, context);
    return object ? { kind: 'position', object, index: preceding.length } : undefined;
  }
  return undefined;
}

export function initializerMember(node: Node, location: (node: Node) => Location, context?: (node: Node) => string[]): TypedExpression | undefined {
  const designator = node.parent, pair = designator?.parent, list = pair?.parent;
  return designator?.type === 'field_designator' && pair?.type === 'initializer_pair' && list?.type === 'initializer_list'
    ? designatorPath(pair, initializerTarget(list, location, 0, context), designator) : undefined;
}
