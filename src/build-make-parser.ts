import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { Language, Node, Parser } from 'web-tree-sitter';
import { BuildEvidence } from './build-context';

export const MAKE_EXTRACTION_VERSION = 'tree-sitter-make-1.1.1-empty-replacement:1';
type Recipe = { text: string; evidence: BuildEvidence };
type Branch = { operator?: 'ifeq' | 'ifneq' | 'ifdef' | 'ifndef'; left?: string; right?: string; body: MakeStatement[] };
export type MakeStatement = { evidence: BuildEvidence } & (
  { kind: 'assignment'; name: string; operator: string; value: string; targets?: string; exported: boolean } |
  { kind: 'condition'; branches: Branch[] } |
  { kind: 'include'; value: string; optional: boolean } |
  { kind: 'export'; names: string } |
  { kind: 'rule'; targets: string; prerequisites: string; orderOnly: string; recipes: Recipe[] } |
  { kind: 'unsupported'; code: string; message: string }
);

let language: Promise<Language> | undefined;
function loadLanguage() {
  return language ??= (async () => {
    const bundled = path.join(__dirname, 'web-tree-sitter.wasm');
    const packaged = existsSync(bundled);
    await Parser.init({ locateFile: () => packaged ? bundled : require.resolve('web-tree-sitter/web-tree-sitter.wasm') });
    return Language.load(packaged ? path.join(__dirname, 'tree-sitter-make.wasm') : path.join(__dirname, '../vendor/tree-sitter-make/tree-sitter-make.wasm'));
  })().catch(error => { language = undefined; throw error; });
}

// Make comments and continuations are evaluated here only for non-recipe values.
function valueText(raw: string) {
  const text = raw.replace(/[ \t]*\\\r?\n[ \t]*/g, ' ');
  let result = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '#') break;
    if (text[i] === '\\') {
      let end = i;
      while (text[end] === '\\') end++;
      if (text[end] === '#') {
        result += '\\'.repeat(Math.floor((end - i) / 2));
        if ((end - i) % 2 === 0) break;
        result += '#'; i = end; continue;
      }
      result += text.slice(i, end); i = end - 1; continue;
    }
    result += text[i];
  }
  return result;
}

export async function parseMakefile(text: string, uri: string): Promise<MakeStatement[]> {
  const evidence = (node?: Node): BuildEvidence => ({ uri, line: node?.startPosition.row ?? 0,
    expression: node ? text.slice(node.startIndex, Math.min(node.endIndex, text.length)).replace(/[\r\n]+$/, '') : '' });
  const unsupported = (node: Node | undefined, code: string, message: string): MakeStatement => ({ kind: 'unsupported', code, message, evidence: evidence(node) });
  if (text.length > 1_048_576) return [unsupported(undefined, 'file-limited', 'Make input exceeds 1 MiB')];
  let grammar: Language;
  try { grammar = await loadLanguage(); }
  catch (error) { return [unsupported(undefined, 'make-parser-unavailable', `Make grammar cannot be loaded: ${String(error)}`)]; }
  const parser = new Parser();
  let tree: ReturnType<Parser['parse']>;
  try {
    try { parser.setLanguage(grammar); }
    catch (error) { language = undefined; return [unsupported(undefined, 'make-parser-unavailable', `Make grammar is incompatible: ${String(error)}`)]; }
    const started = performance.now();
    tree = parser.parse(text.endsWith('\n') ? text : text + '\n', null, { progressCallback: () => performance.now() - started > 1000 });
    if (!tree) return [unsupported(undefined, 'extraction-limited', 'Make syntax parsing time limit')];
    let visited = 0;
    const field = (node: Node, name: string) => node.childForFieldName(name);
    const value = (node: Node | null) => node ? valueText(node.text) : '';
    function statements(nodes: Node[], depth: number): MakeStatement[] {
      const result: MakeStatement[] = [];
      for (const node of nodes) {
        if (++visited > 20_000 || depth > 32) { result.push(unsupported(node, 'extraction-limited', 'Make syntax traversal limit')); break; }
        if (node.type === 'comment') continue;
        const itemEvidence = evidence(node);
        if (node.type === 'conditional') {
          const branches: Branch[] = [];
          let invalid = false;
          for (const branch of [node, ...node.namedChildren.filter(n => n.type === 'elsif_directive' || n.type === 'else_directive')]) {
            const condition = field(branch, 'condition');
            if (condition?.hasError || condition?.isMissing) { invalid = true; break; }
            const operator = condition?.type.replace(/_directive$/, '') as Branch['operator'];
            const parenthesized = condition?.children.some(n => n.type === '(');
            const argument = (name: string) => {
              const n = condition && field(condition, name);
              const raw = value(n ?? null);
              return n?.type === 'string' && !parenthesized ? raw.slice(1, -1) : raw.trim();
            };
            branches.push({ operator, ...(condition ? { left: argument(operator === 'ifdef' || operator === 'ifndef' ? 'variable' : 'arg0'), right: argument('arg1') } : {}),
              body: statements(branch.childrenForFieldName('consequence'), depth + 1) });
          }
          if (invalid || node.children.some(n => n.isMissing || n.type === 'ERROR')) result.push(unsupported(node, 'make-syntax-error', 'Malformed Make conditional'));
          else result.push({ kind: 'condition', branches, evidence: itemEvidence });
          continue;
        }
        if (node.hasError || node.isMissing || node.type === 'ERROR') { result.push(unsupported(node, 'make-syntax-error', 'Malformed Make syntax')); continue; }
        if (node.type === 'variable_assignment' || node.type === 'define_directive') {
          const definition = node.type === 'define_directive';
          result.push({ kind: 'assignment', name: value(field(node, 'name')), operator: field(node, 'operator')?.text ?? '=',
            value: definition ? (field(node, 'value')?.text ?? '').replace(/\r?\n$/, '') : value(field(node, 'value')),
            targets: field(node, 'target_or_pattern') ? value(field(node, 'target_or_pattern')) : undefined,
            exported: false, evidence: itemEvidence });
        } else if (node.type === 'include_directive') {
          result.push({ kind: 'include', value: value(field(node, 'filenames')), optional: node.firstChild?.text !== 'include', evidence: itemEvidence });
        } else if (node.type === 'export_directive') {
          const assignment = node.namedChildren.find(n => n.type === 'variable_assignment');
          if (assignment) {
            for (const s of statements([assignment], depth + 1)) result.push(s.kind === 'assignment' ? { ...s, exported: true, evidence: itemEvidence } : s);
          } else if (field(node, 'variables')) result.push({ kind: 'export', names: value(field(node, 'variables')), evidence: itemEvidence });
          else result.push(unsupported(node, 'unsupported-statement', 'Export-all Make semantics are not evaluated'));
        } else if (node.type === 'rule') {
          const recipes: Recipe[] = [], recipe = node.namedChildren.find(n => n.type === 'recipe');
          if (node.children.some(n => n.type === '::' || n.type === '&:') || field(node, 'target') || recipe?.namedChildren.some(n => n.type !== 'recipe_line' && n.type !== 'comment')) {
            result.push(unsupported(node, 'unsupported-statement', 'Make rule semantics are not evaluated')); continue;
          }
          for (const line of recipe?.namedChildren ?? []) if (line.type === 'recipe_line') recipes.push({
            text: line.text.replace(/\\\r?\n\t?/g, '').trim(), evidence: evidence(line)
          });
          result.push({ kind: 'rule', targets: value(node.namedChildren.find(n => n.type === 'targets') ?? null).trim(),
            prerequisites: value(field(node, 'normal')).trim(), orderOnly: value(field(node, 'order_only')).trim(), recipes, evidence: itemEvidence });
        } else result.push(unsupported(node, 'unsupported-statement', `Make syntax is not evaluated: ${node.type}`));
      }
      return result;
    }
    return statements(tree.rootNode.namedChildren, 0);
  } finally {
    tree!?.delete();
    parser.delete();
  }
}
