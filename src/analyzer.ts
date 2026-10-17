import { Parser, Language, Node } from 'web-tree-sitter';
import { Access, FileAnalysis, FlowExpression, Location, ReferenceRecord, SymbolRecord } from './model';
import { aggregateId, declaredType, declarator, typedExpression } from './type-info';
import { deriveMacroCalls } from './project-analysis';
import { flowFacts } from './flow-parser';
import { inferPointerCalls } from './pointer-targets';

function ancestor(node: Node, type: string): Node | null {
  for (let current = node.parent; current; current = current.parent) if (current.type === type) return current;
  return null;
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
  const analyzer = { analyze(uri: string, text: string, skipInactive = true): FileAnalysis {
    const tree = parser.parse(text);
    if (!tree) throw new Error('C parser returned no tree');
    const file: FileAnalysis = { uri, text, symbols: [], references: [], includes: [], issues: [] };
    const nodes: Node[] = [];
    const conditions = new Map<number, string[]>();
    const declarationNames = new Set<number>();
    const functionOwners = new Map<number, string>();
    const initializerOwners = new Map<number, string>();
    const aggregates = new Map<number, SymbolRecord>();
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
        if (skipInactive && value === false) (file.inactive ??= []).push({ start: condition!.endIndex, end: alternative?.startIndex ?? node.endIndex });
        if (skipInactive && value === true && alternative) (file.inactive ??= []).push({ start: alternative.startIndex, end: alternative.endIndex });
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
    const top = tree.rootNode.namedChildren.filter(node => node.type !== 'comment');
    const guard = top.length === 1 && top[0].type === 'preproc_ifdef' && top[0].text.startsWith('#ifndef') ? top[0] : undefined;
    const guardName = guard?.childForFieldName('name')?.text;
    if (guard && guardName && !guard.childForFieldName('alternative') && guard.namedChildren.some(node => node.type === 'preproc_def' && node.childForFieldName('name')?.text === guardName))
      file.guard = { name: guardName, condition: guard.text.slice(0, guard.text.indexOf('\n')).trim() };

    function aggregateOwner(node: Node) {
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (['struct_specifier', 'union_specifier'].includes(parent.type)) return aggregates.get(parent.id);
      }
      return undefined;
    }

    function addSymbol(name: Node, extent: Node, kind: SymbolRecord['kind'], definition: boolean, pointer = false) {
      if (declarationNames.has(name.id)) return file.symbols.find(s => s.location.start === name.startIndex)!;
      declarationNames.add(name.id);
      const enclosingFunction = ancestor(extent, 'function_definition');
      let block = ancestor(extent, 'compound_statement') ?? enclosingFunction;
      const loop = ancestor(extent, 'for_statement');
      if (loop && (!block || loop.startIndex > block.startIndex)) block = loop;
      const parameters = ancestor(extent, 'parameter_list');
      if (extent.type === 'parameter_declaration' || (kind === 'type' && parameters)) {
        const declaration = enclosingFunction?.childForFieldName('declarator');
        const functionName = declaration && declarator(declaration).name;
        const definitionParameters = functionName && ancestor(functionName, 'function_declarator')?.childForFieldName('parameters');
        // Only the defining function's own parameters are visible in its body.
        block = parameters?.id === definitionParameters?.id ? enclosingFunction : parameters;
      }
      const external = extent.namedChildren.some(n => n.type === 'storage_class_specifier' && n.text === 'extern');
      const scope = block && kind !== 'macro' ? { start: block.startIndex, end: block.endIndex } : undefined;
      const storage = external ? 'global' : scope ? 'local' : extent.namedChildren.some(n => n.type === 'storage_class_specifier' && n.text === 'static') ? 'static' : 'global';
      const symbol: SymbolRecord = { id: `${uri}#${name.startIndex}`, name: name.text, kind,
        location: location(name), extent: location(extent), definition, pointer, storage, scope,
        conditions: conditions.get(extent.id) ?? [] };
      file.symbols.push(symbol);
      return symbol;
    }
    for (const node of nodes) {
      if (node.type.startsWith('preproc_')) for (const child of node.children) {
        if (!child.type.startsWith('#') && child.type !== 'preproc_directive') continue;
        let end = text.indexOf('\n', child.startIndex);
        while (end >= 0 && /\\\r?$/.test(text.slice(child.startIndex, end))) end = text.indexOf('\n', end + 1);
        (file.directives ??= []).push({ start: child.startIndex, end: end < 0 ? text.length : end + 1 });
      }
      if (node.type === 'ERROR') file.issues.push(`Line ${node.startPosition.row + 1}: incomplete or unsupported C syntax`);
      if (node.isMissing) file.issues.push(`Line ${node.startPosition.row + 1}: missing ${node.type}`);
      if (node.type === 'preproc_include') {
        const path = node.childForFieldName('path')?.text;
        if (path) file.includes.push(path.slice(1, -1));
        if (path?.startsWith('<')) (file.systemIncludes ??= []).push(path.slice(1, -1));
        if (path && /^['"<]/.test(path)) (file.preprocessor ??= []).push({ kind: 'include', location: location(node), conditions: conditions.get(node.id) ?? [], path: path.slice(1, -1), system: path.startsWith('<') });
      }
      if (['preproc_def', 'preproc_function_def'].includes(node.type)) {
        const name = node.childForFieldName('name');
        if (name) {
          addSymbol(name, node, 'macro', true);
          const parameters = node.childForFieldName('parameters')?.text.slice(1, -1).split(',').map(p => p.trim()).filter(Boolean);
          let variadic: string | undefined;
          if (parameters?.at(-1)?.endsWith('...')) variadic = parameters.pop()!.slice(0, -3).trim() || '__VA_ARGS__';
          (file.preprocessor ??= []).push({ kind: 'define', location: location(node), conditions: conditions.get(node.id) ?? [],
            macro: { name: name.text, location: location(name), body: node.childForFieldName('value')?.text ?? '', parameters, variadic, conditions: conditions.get(node.id) ?? [] } });
        }
      }
      if (node.type === 'preproc_call' && node.childForFieldName('directive')?.text === '#undef')
        (file.preprocessor ??= []).push({ kind: 'undef', name: node.childForFieldName('argument')?.text.trim() ?? '', location: location(node), conditions: conditions.get(node.id) ?? [] });
      if (node.type === 'function_definition') {
        const declaration = node.childForFieldName('declarator');
        const name = declaration && declarator(declaration).name;
        if (name) {
          const symbol = addSymbol(name, node, 'function', true); functionOwners.set(node.id, symbol.id);
          symbol.type = declaredType(node, declaration!, uri);
          const body = node.childForFieldName('body');
          if (body) (file.functions ??= []).push({ id: symbol.id, location: location(node), body: location(body) });
        }
      }
      if (['struct_specifier', 'union_specifier', 'enum_specifier'].includes(node.type) &&
        (node.childForFieldName('body') || ['translation_unit', 'compound_statement'].includes(node.parent?.type ?? ''))) {
        const name = node.childForFieldName('name');
        const symbol = addSymbol(name ?? node, node, 'type', !!node.childForFieldName('body'));
        symbol.id = aggregateId(node, uri);
        symbol.aggregate = node.type.split('_')[0] as SymbolRecord['aggregate'];
        if (!name) {
          const parentName = node.parent?.childrenForFieldName('declarator')[0];
          const alias = parentName && declarator(parentName).name?.text;
          const owner = aggregateOwner(node);
          symbol.name = alias ? (owner ? `${owner.name}.${alias}` : alias) : `anonymous@${node.startPosition.row + 1}:${node.startPosition.column + 1}`;
          symbol.location = { ...symbol.location, end: node.startIndex + symbol.aggregate!.length, endLine: node.startPosition.row, endColumn: node.startPosition.column + symbol.aggregate!.length };
        }
        aggregates.set(node.id, symbol);
      }
      // A trailing annotation macro can make an otherwise intact prototype an ERROR node.
      const annotatedPrototype = node.type === 'ERROR' && node.nextSibling?.text === ';' &&
        node.namedChildren.some(child => ['primitive_type', 'type_identifier', 'sized_type_specifier', 'struct_specifier', 'union_specifier', 'enum_specifier'].includes(child.type));
      if (annotatedPrototype || ['declaration', 'parameter_declaration', 'type_definition', 'field_declaration'].includes(node.type)) {
        const declarations = annotatedPrototype ? node.namedChildren.filter(child => child.type === 'function_declarator') : node.childrenForFieldName('declarator');
        for (const child of declarations) {
          const target = child.type === 'init_declarator' ? child.childForFieldName('declarator')! : child;
          const info = declarator(target);
          if (!info.name) continue;
          const kind = node.type === 'type_definition' ? 'type' : info.functionLike && node.type !== 'parameter_declaration' ? 'function' : 'variable';
          const external = node.namedChildren.some(n => n.type === 'storage_class_specifier' && n.text === 'extern');
          const symbol = addSymbol(info.name, node, kind, kind !== 'function' && (!external || child.type === 'init_declarator'), info.pointer || (node.type === 'parameter_declaration' && info.functionLike));
          symbol.type = declaredType(node, target, uri);
          if (node.type === 'field_declaration') {
            const owner = aggregateOwner(node);
            symbol.memberOf = owner?.id;
            symbol.containerName = owner?.name;
          }
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
      if (node.type === 'call_expression') {
        const expression = node.childForFieldName('function');
        let callable = expression;
        while (callable?.type === 'parenthesized_expression') callable = callable.namedChildren[0];
        const fn = ancestor(node, 'function_definition');
        const body = fn?.childForFieldName('body');
        if (expression && callable?.type !== 'identifier' && body && node.startIndex >= body.startIndex && access(node)) {
          const functionId = functionOwners.get(fn!.id);
          file.references.push({ id: `${uri}@${expression.startIndex}:indirect`, name: expression.text, kind: 'call',
            location: location(expression), ownerId: functionId, functionId, indirect: true,
            flowKey: `${functionId}:call:${node.startIndex}`,
            access: 'read', conditions: conditions.get(node.id) ?? [] });
        }
      }
      if (!['identifier', 'field_identifier'].includes(node.type) || declarationNames.has(node.id)) continue;
      const fn = ancestor(node, 'function_definition');
      const body = fn?.childForFieldName('body');
      const initializer = ancestor(node, 'init_declarator');
      const value = initializer?.childForFieldName('value');
      const inBody = body && node.startIndex >= body.startIndex;
      const inInitializer = value && node.startIndex >= value.startIndex;
      if (!inBody && !inInitializer) continue;
      if (node.type === 'field_identifier') {
        const expression = node.parent?.type === 'field_expression' ? typedExpression(node.parent, location) : undefined;
        if (expression?.kind === 'member') {
          const functionId = fn ? functionOwners.get(fn.id) : undefined;
          file.references.push({ id: `${uri}@${node.startIndex}`, name: node.text, kind: 'reference',
            location: location(node), ownerId: functionId, functionId, access: access(node.parent!),
            conditions: conditions.get(node.id) ?? [], member: expression });
        }
        continue;
      }
      // Labels, member field names and attributes are not ordinary identifier references.
      if (['labeled_statement', 'goto_statement', 'attribute_specifier', 'attribute_declaration'].includes(node.parent?.type ?? '')) continue;
      if (ancestor(node, 'parameter_list') && !inInitializer) continue;
      let callable: Node = node;
      while (callable.parent?.type === 'parenthesized_expression') callable = callable.parent;
      const call = callable.parent?.type === 'call_expression' && callable.parent.childForFieldName('function')?.id === callable.id;
      file.references.push({ id: `${uri}@${node.startIndex}`, name: node.text, kind: call ? 'call' : 'reference',
        flowKey: call && fn ? `${functionOwners.get(fn.id)}:call:${callable.parent!.startIndex}` : undefined,
        access: access(node), functionId: fn ? functionOwners.get(fn.id) : undefined,
        location: location(node), ownerId: call && fn ? functionOwners.get(fn.id) : inInitializer && initializerOwners.has(initializer!.id)
          ? initializerOwners.get(initializer!.id) : fn ? functionOwners.get(fn.id) : undefined,
        conditions: conditions.get(node.id) ?? [] });
    }
    file.issues = [...new Set(file.issues)];
    file.statementConditions = nodes.filter(node => ['return_statement', 'expression_statement'].includes(node.type) && conditions.get(node.id)?.length)
      .map(node => ({ start: node.startIndex, conditions: conditions.get(node.id)! }));
    Object.assign(file, flowFacts(tree.rootNode, uri, location, new Set(nodes.map(node => node.id)), skipInactive, '', node => conditions.get(node.id) ?? []));
    tree.delete();
    return file;
  }, calls(uri: string, text: string, original?: (start: number, end: number) => Location, namespace = '', context?: (location: Location) => string[]) {
    const tree = parser.parse(text);
    if (!tree) throw new Error('C parser returned no expanded tree');
    const references: ReferenceRecord[] = [];
    const generatedLocation = (node: Node): Location => ({ uri, start: node.startIndex, end: node.endIndex,
      line: node.startPosition.row, column: node.startPosition.column, endLine: node.endPosition.row, endColumn: node.endPosition.column });
    const locate = (node: Node): Location => original ? original(node.startIndex, node.endIndex) : generatedLocation(node);
    function visit(node: Node, owner?: string) {
      if (node.type === 'function_definition') {
        const body = node.childForFieldName('body'), name = declarator(node.childForFieldName('declarator')!).name;
        if (body && name) visit(body, `${uri}#${locate(name).start}`); return;
      }
      if (['sizeof_expression', 'alignof_expression', 'attribute_specifier', 'attribute_declaration'].includes(node.type)) return;
      if (owner && node.type === 'call_expression') {
        const expression = node.childForFieldName('function'); let callable = expression;
        while (callable?.type === 'parenthesized_expression') callable = callable.namedChildren[0];
        if (expression && callable) {
          const direct = callable.type === 'identifier';
          const name = direct ? callable : expression;
          references.push({ id: `${uri}@${name.startIndex}`, name: name.text, kind: 'call', location: generatedLocation(name),
            access: 'read', conditions: [], indirect: !direct, flowKey: `${owner}${namespace}:call:${node.startIndex}` });
        }
      }
      for (const child of node.namedChildren) visit(child, owner);
    }
    visit(tree.rootNode);
    const issues = tree.rootNode.hasError ? ['Expanded C contains incomplete or unsupported syntax'] : [];
    const facts = flowFacts(tree.rootNode, uri, locate, undefined, true, namespace, node => context?.(locate(node)) ?? []);
    tree.delete(); return { references, issues, ...facts };
  }, initializer(uri: string, text: string, original: (start: number, end: number) => Location) {
    const prefix = 'int __macro_value = ', tree = parser.parse(prefix + text + ';');
    if (!tree) throw new Error('C parser returned no initializer tree');
    const facts = flowFacts(tree.rootNode, uri, node => original(Math.max(0, node.startIndex - prefix.length), Math.max(0, node.endIndex - prefix.length)));
    const value: FlowExpression = facts.initializers[0]?.value ?? { kind: 'unknown', location: original(0, text.length) };
    const issues = tree.rootNode.hasError ? ['Expanded initializer has incomplete or unsupported syntax'] : [];
    tree.delete(); return { value, issues };
  }, derive(files: FileAnalysis[]): FileAnalysis[] { return inferPointerCalls(deriveMacroCalls(files, analyzer.analyze, analyzer.calls, analyzer.initializer)); } };
  return analyzer;
}
