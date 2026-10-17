import { Node } from 'web-tree-sitter';
import { CType, Location, TypedExpression } from './model';

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
    if (node.type === 'pointer_declarator') layers.unshift('pointer');
    if (node.type === 'array_declarator') layers.unshift('array');
    if (node.type === 'function_declarator') layers.unshift('function');
    node = node.childForFieldName('declarator') ?? (node.type === 'parenthesized_declarator' ? node.namedChildren[0] : null);
  }
  if (['struct_specifier', 'union_specifier', 'enum_specifier'].includes(base.type)) {
    return { name: base.childForFieldName('name')?.text ?? '', tag: base.type.split('_')[0] as CType['tag'],
      id: base.childForFieldName('body') ? aggregateId(base, uri) : undefined, layers };
  }
  return { name: base.text, layers };
}

export function typedExpression(node: Node, location: (node: Node) => Location, depth = 0): TypedExpression | undefined {
  if (depth >= 32) return undefined;
  if (node.type === 'identifier') return { kind: 'identifier', name: node.text, location: location(node) };
  if (node.type === 'parenthesized_expression') {
    const child = node.namedChildren[0];
    return child && typedExpression(child, location, depth + 1);
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
