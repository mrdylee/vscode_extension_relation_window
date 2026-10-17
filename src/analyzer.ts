import { Parser, Language, Node } from 'web-tree-sitter';
import { Access, FileAnalysis, Location, SymbolRecord } from './model';

function ancestor(node: Node, type: string): Node | null {
  for (let current = node.parent; current; current = current.parent) if (current.type === type) return current;
  return null;
}
function declarator(node: Node): { name?: Node; functionLike: boolean; pointer: boolean } {
  const chain: Node[] = [];
  let current: Node | null = node;
  while (current) {
    chain.push(current);
    if (['identifier', 'type_identifier', 'field_identifier'].includes(current.type)) break;
    current = current.childForFieldName('declarator') ??
      (current.type === 'parenthesized_declarator' ? current.namedChildren[0] : null);
  }
  const name = chain.at(-1);
  const wrappers = chain.slice(0, -1).reverse().filter(n => n.type !== 'parenthesized_declarator');
  return {
    name: name && ['identifier', 'type_identifier', 'field_identifier'].includes(name.type) ? name : undefined,
    functionLike: wrappers[0]?.type === 'function_declarator',
    pointer: wrappers.some(n => n.type === 'pointer_declarator')
  };
}
// Unknown macros are not assumed undefined: the source folder has no build configuration.
function constant(node: Node): boolean | undefined {
  let text = node.text.replace(/\s/g, '');
  while (text.startsWith('(') && text.endsWith(')')) text = text.slice(1, -1);
  if (/^0(?:[uUlL]*)$/.test(text)) return false;
  if (/^1(?:[uUlL]*)$/.test(text)) return true;
  return undefined;
}

function access(node: Node): Access | undefined {
  if (ancestor(node, 'sizeof_expression') || ancestor(node, 'alignof_expression')) return undefined;
  let expression = node;
  while (expression.parent?.type === 'parenthesized_expression') expression = expression.parent;
  const parent = expression.parent;
  if (parent?.type === 'assignment_expression' && parent.childForFieldName('left')?.id === expression.id)
    return parent.childForFieldName('operator')?.text === '=' ? 'write' : 'readwrite';
  if (parent?.type === 'update_expression') return 'readwrite';
  if (parent?.type === 'pointer_expression' && parent.childForFieldName('operator')?.text === '&') return 'address';
  return 'read';
}

export async function createAnalyzer(runtime: string, grammar: string) {
  await Parser.init({ locateFile: () => runtime });
  const parser = new Parser();
  parser.setLanguage(await Language.load(grammar));
  return { analyze(uri: string, text: string, skipInactive = true): FileAnalysis {
    const tree = parser.parse(text);
    if (!tree) throw new Error('C parser returned no tree');
    const file: FileAnalysis = { uri, text, symbols: [], references: [], includes: [], issues: [] };
    const nodes: Node[] = [];
    const conditions = new Map<number, string[]>();
    const declarationNames = new Set<number>();
    const functionOwners = new Map<number, string>();
    const initializerOwners = new Map<number, string>();
    const location = (node: Node): Location => ({ uri, start: node.startIndex, end: node.endIndex,
      line: node.startPosition.row, column: node.startPosition.column,
      endLine: node.endPosition.row, endColumn: node.endPosition.column });

    function visit(node: Node, context: string[]) {
      nodes.push(node);
      conditions.set(node.id, context);
      if (['preproc_if', 'preproc_elif', 'preproc_ifdef', 'preproc_elifdef'].includes(node.type)) {
        const condition = node.childForFieldName('condition') ?? node.childForFieldName('name');
        const alternative = node.childForFieldName('alternative');
        const value = condition && ['preproc_if', 'preproc_elif'].includes(node.type) ? constant(condition) : undefined;
        const label = node.text.slice(0, node.text.indexOf('\n')).trim();
        if (!skipInactive || value !== false) {
          const next = value === true && skipInactive ? context : [...context, label];
          for (const child of node.namedChildren) {
            if (child.id !== condition?.id && child.id !== alternative?.id) visit(child, next);
          }
        }
        if (alternative && (!skipInactive || value !== true)) {
          visit(alternative, value === false && skipInactive ? context : [...context, `else of ${label}`]);
        }
        return;
      }
      // Preprocessor bodies are text, not compiled C; don't invent expanded calls.
      if (['preproc_def', 'preproc_function_def', 'preproc_include'].includes(node.type)) return;
      for (const child of node.namedChildren) visit(child, context);
    }
    visit(tree.rootNode, []);

    function addSymbol(name: Node, extent: Node, kind: SymbolRecord['kind'], definition: boolean, pointer = false) {
      if (declarationNames.has(name.id)) return file.symbols.find(s => s.location.start === name.startIndex)!;
      declarationNames.add(name.id);
      const enclosingFunction = ancestor(extent, 'function_definition');
      let block = ancestor(extent, 'compound_statement') ?? enclosingFunction;
      const loop = ancestor(extent, 'for_statement');
      if (loop && (!block || loop.startIndex > block.startIndex)) block = loop;
      if (extent.type === 'parameter_declaration') {
        const parameters = ancestor(extent, 'parameter_list');
        const declaration = enclosingFunction?.childForFieldName('declarator');
        const functionName = declaration && declarator(declaration).name;
        const definitionParameters = functionName && ancestor(functionName, 'function_declarator')?.childForFieldName('parameters');
        // Only the defining function's own parameters are visible in its body.
        block = parameters?.id === definitionParameters?.id ? enclosingFunction : parameters;
      }
      const external = extent.namedChildren.some(n => n.type === 'storage_class_specifier' && n.text === 'extern');
      const scope = block ? { start: block.startIndex, end: block.endIndex } : undefined;
      const storage = external ? 'global' : scope ? 'local' : extent.namedChildren.some(n => n.type === 'storage_class_specifier' && n.text === 'static') ? 'static' : 'global';
      const symbol: SymbolRecord = { id: `${uri}#${name.startIndex}`, name: name.text, kind,
        location: location(name), extent: location(extent), definition, pointer, storage, scope,
        conditions: conditions.get(extent.id) ?? [] };
      file.symbols.push(symbol);
      return symbol;
    }
    for (const node of nodes) {
      if (node.type === 'ERROR') file.issues.push(`Line ${node.startPosition.row + 1}: incomplete or unsupported C syntax`);
      if (node.isMissing) file.issues.push(`Line ${node.startPosition.row + 1}: missing ${node.type}`);
      if (node.type === 'preproc_include') {
        const path = node.childForFieldName('path')?.text;
        if (path) file.includes.push(path.slice(1, -1));
      }
      if (['preproc_def', 'preproc_function_def'].includes(node.type)) {
        const name = node.childForFieldName('name');
        if (name) addSymbol(name, node, 'macro', true);
      }
      if (node.type === 'function_definition') {
        const declaration = node.childForFieldName('declarator');
        const name = declaration && declarator(declaration).name;
        if (name) functionOwners.set(node.id, addSymbol(name, node, 'function', true).id);
      }
      if (['struct_specifier', 'union_specifier', 'enum_specifier'].includes(node.type) && node.childForFieldName('body')) {
        const name = node.childForFieldName('name');
        if (name) addSymbol(name, node, 'type', true);
      }
      // A trailing annotation macro can make an otherwise intact prototype an ERROR node.
      const annotatedPrototype = node.type === 'ERROR' && node.nextSibling?.text === ';' &&
        node.namedChildren.some(child => ['primitive_type', 'type_identifier', 'sized_type_specifier', 'struct_specifier', 'union_specifier', 'enum_specifier'].includes(child.type));
      if (annotatedPrototype || ['declaration', 'parameter_declaration', 'type_definition'].includes(node.type)) {
        const declarations = annotatedPrototype ? node.namedChildren.filter(child => child.type === 'function_declarator') : node.childrenForFieldName('declarator');
        for (const child of declarations) {
          const target = child.type === 'init_declarator' ? child.childForFieldName('declarator')! : child;
          const info = declarator(target);
          if (!info.name) continue;
          const kind = node.type === 'type_definition' ? 'type' : info.functionLike ? 'function' : 'variable';
          const external = node.namedChildren.some(n => n.type === 'storage_class_specifier' && n.text === 'extern');
          const symbol = addSymbol(info.name, node, kind, kind !== 'function' && (!external || child.type === 'init_declarator'), info.pointer);
          if (child.type === 'init_declarator') initializerOwners.set(child.id, symbol.id);
          if (kind === 'variable' && child.type === 'init_declarator') {
            const fn = ancestor(node, 'function_definition');
            const functionId = fn ? functionOwners.get(fn.id) : undefined;
            file.references.push({ id: `${uri}@${info.name.startIndex}`, name: info.name.text, kind: 'reference',
              location: location(info.name), ownerId: functionId, functionId, targetId: symbol.id, access: 'write', conditions: symbol.conditions });
          }
          if (kind === 'function' || (kind === 'variable' && !symbol.definition)) file.references.push({ id: `${uri}@${info.name.startIndex}`, name: info.name.text,
            kind: 'declaration', location: location(info.name), conditions: symbol.conditions });
        }
      }
    }

    for (const node of nodes) {
      if (node.type !== 'identifier' || declarationNames.has(node.id)) continue;
      const fn = ancestor(node, 'function_definition');
      const body = fn?.childForFieldName('body');
      const initializer = ancestor(node, 'init_declarator');
      const value = initializer?.childForFieldName('value');
      const inBody = body && node.startIndex >= body.startIndex;
      const inInitializer = value && node.startIndex >= value.startIndex;
      if (!inBody && !inInitializer) continue;
      // Labels, member field names and attributes are not ordinary identifier references.
      if (['labeled_statement', 'goto_statement', 'attribute_specifier', 'attribute_declaration'].includes(node.parent?.type ?? '')) continue;
      if (ancestor(node, 'parameter_list') && !inInitializer) continue;
      let callable: Node = node;
      while (callable.parent?.type === 'parenthesized_expression') callable = callable.parent;
      const call = callable.parent?.type === 'call_expression' && callable.parent.childForFieldName('function')?.id === callable.id;
      file.references.push({ id: `${uri}@${node.startIndex}`, name: node.text, kind: call ? 'call' : 'reference',
        access: access(node), functionId: fn ? functionOwners.get(fn.id) : undefined,
        location: location(node), ownerId: call && fn ? functionOwners.get(fn.id) : inInitializer && initializerOwners.has(initializer!.id)
          ? initializerOwners.get(initializer!.id) : fn ? functionOwners.get(fn.id) : undefined,
        conditions: conditions.get(node.id) ?? [] });
    }
    file.issues = [...new Set(file.issues)];
    tree.delete();
    return file;
  } };
}
