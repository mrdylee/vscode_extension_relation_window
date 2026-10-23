import { AnalysisWorkBudget } from './analysis-budget';
import { MacroBranch, MacroDefinition } from './model';
import { CToken, identifier, tokenizeC } from './c-tokens';
import { combineBranches } from './preprocessor-branches';

export interface MacroChoice { macro?: MacroDefinition; branches: MacroBranch[] }
export interface ExpansionVariant { tokens: CToken[]; changed: boolean; conditions: string[]; branches: MacroBranch[] }
interface Arguments { values: CToken[][]; end: number }
export const macroMemoryLimit = 'Macro analysis memory budget reached; results may be incomplete. Narrow Include/Exclude scope.';
export function macroArguments(tokens: CToken[], open: number): Arguments | undefined {
  if (tokens[open]?.text !== '(') return undefined;
  const values: CToken[][] = [[]]; let depth = 0;
  for (let i = open + 1; i < tokens.length; i++) {
    const text = tokens[i].text;
    if (text === ')' && depth === 0) return { values, end: i + 1 };
    if (text === ',' && depth === 0) values.push([]);
    else { values.at(-1)!.push(tokens[i]); if (text === '(') depth++; if (text === ')') depth--; }
  }
  return undefined;
}

// Tokens, not regular-expression text replacement: #/## use unexpanded arguments.
export class MacroExpander {
  readonly issues = new Set<string>();
  private operations = 0;
  constructor(private lookup: (name: string, offset: number) => MacroChoice[], private memoryPressure?: () => boolean, private shouldCancel?: () => boolean, private budget?: AnalysisWorkBudget, private scope = 'macros') {}
  expand(input: CToken[], nesting = 0, branches: MacroBranch[] = []): ExpansionVariant[] {
    if (this.shouldCancel?.()) { this.issues.add('Macro analysis cancelled; call relationships may be incomplete.'); return [{ tokens: input, changed: false, conditions: [], branches }]; }
    if (this.memoryPressure?.()) {
      this.issues.add(macroMemoryLimit); return [{ tokens: input, changed: false, conditions: [], branches }];
    }
    if (nesting >= 32 || input.length > 40_000) {
      this.issues.add('Macro expansion limit: 32 nested expansions or 40,000 tokens');
      return [{ tokens: input.map(token => ({ ...token, unexpanded: true })), changed: false, conditions: [], branches }];
    }
    const pending = [{ tokens: input, changed: false, conditions: branches.map(branch => branch.condition), branches, index: 0 }];
    const output: ExpansionVariant[] = [];
    while (pending.length && output.length < 32) {
      const variant = pending.pop()!;
      let branched = false;
      while (variant.index < variant.tokens.length) {
        if (this.budget && this.budget.consume(this.scope, 1, 'macros') !== 'ok') {
          this.issues.add('Macro analysis work limit reached; some calls remain unexpanded');
          variant.tokens = variant.tokens.map(token => ({ ...token, unexpanded: true })); break;
        }
        if (++this.operations > 80_000 || variant.tokens.length > 40_000) {
          this.issues.add('Macro expansion work/token limit reached; some calls remain unexpanded');
          variant.tokens = variant.tokens.map((token, i) => i >= variant.index ? { ...token, unexpanded: true } : token); break;
        }
        if ((this.operations & 255) === 0 && this.shouldCancel?.()) {
          this.issues.add('Macro analysis cancelled; call relationships may be incomplete.'); return [{ tokens: input, changed: false, conditions: [], branches }];
        }
        if ((this.operations & 255) === 0 && this.memoryPressure?.()) {
          this.issues.add(macroMemoryLimit); return [{ tokens: input, changed: false, conditions: [], branches }];
        }
        const token = variant.tokens[variant.index];
        if (!identifier.test(token.text) || token.hidden?.includes(token.text)) { variant.index++; continue; }
        const choices = this.lookup(token.text, token.location.start);
        if (!choices.length) { variant.index++; continue; }
        const options: typeof pending = [];
        for (const choice of choices) {
          const selected = combineBranches(variant.branches, choice.branches);
          if (!selected) continue;
          const macro = choice.macro;
          const conditions = [...new Set([...variant.conditions, ...selected.map(branch => branch.condition)])];
          const args = macro?.parameters ? macroArguments(variant.tokens, variant.index + 1) : undefined;
          if (!macro || (macro.parameters && !args)) {
            const tokens = [...variant.tokens]; tokens[variant.index] = { ...token, hidden: [...(token.hidden ?? []), token.text] };
            options.push({ ...variant, tokens, branches: selected, conditions, index: variant.index + 1 }); continue;
          }
          const values = args?.values ?? [];
          if (macro.parameters?.length === 0 && values.length === 1 && values[0].length === 0) values.length = 0;
          if (macro.parameters && (values.length < macro.parameters.length || (!macro.variadic && values.length !== macro.parameters.length))) {
            this.issues.add(`Macro ${macro.name}: argument count does not match`);
            const tokens = [...variant.tokens]; tokens[variant.index] = { ...token, unexpanded: true, hidden: [...(token.hidden ?? []), token.text] };
            options.push({ ...variant, tokens, branches: selected, conditions, index: variant.index + 1 }); continue;
          }
          if ((token.chain?.length ?? 0) >= 32) {
            this.issues.add('Macro expansion limit: 32 nested expansions');
            const tokens = [...variant.tokens]; tokens[variant.index] = { ...token, unexpanded: true, hidden: [...(token.hidden ?? []), token.text] };
            options.push({ ...variant, tokens, branches: selected, conditions, index: variant.index + 1 }); continue;
          }
          for (const replacement of this.substitute(macro, values, token, nesting, selected)) {
            const end = args?.end ?? variant.index + 1;
            options.push({ tokens: [...variant.tokens.slice(0, variant.index), ...replacement.tokens, ...variant.tokens.slice(end)],
              index: variant.index, changed: true, branches: replacement.branches, conditions: [...new Set([...conditions, ...macro.conditions, ...replacement.conditions])] });
          }
        }
        if (options.length > 1) {
          const seen = new Map<string, {first: typeof variant; tokens?: Set<string>}>();
          for (let n = 0; n < options.length;) {
            const option = options[n], key = JSON.stringify([option.branches.map(branch => [branch.key, branch.value]).sort(), option.index]), previous = seen.get(key);
            if (!previous) { seen.set(key, {first: option}); n++; continue; }
            // Different paths cannot be duplicates. Compare full token origins
            // only when two options already have the same condition state.
            previous.tokens ??= new Set([JSON.stringify(previous.first.tokens)]);
            const tokens = JSON.stringify(option.tokens);
            if (previous.tokens.has(tokens)) options.splice(n, 1); else { previous.tokens.add(tokens); n++; }
          }
        }
        if (options.length === 1) Object.assign(variant, options[0]);
        else {
          const room = 32 - output.length - pending.length;
          pending.push(...options.slice(0, Math.max(0, room)));
          if (options.length > room || choices.length > 32) this.issues.add('Macro expansion alternative limit: 32 candidates');
          branched = true; break;
        }
      }
      if (!branched) output.push(variant);
    }
    return output;
  }

  private substitute(macro: MacroDefinition, values: CToken[][], invocation: CToken, nesting: number, branches: MacroBranch[]): ExpansionVariant[] {
    const raw = new Map<string, CToken[]>();
    macro.parameters?.forEach((name, i) => raw.set(name, values[i] ?? []));
    if (macro.variadic) {
      const rest = values.slice(macro.parameters!.length);
      raw.set(macro.variadic, rest.flatMap((value, i) => i ? [{ ...invocation, text: ',' }, ...value] : value));
    }
    let body = tokenizeC(macro.body, () => invocation.location);
    // C23 __VA_OPT__ and the common GNU comma-swallowing spelling.
    if (macro.variadic) {
      const nonempty = !!raw.get(macro.variadic)?.length;
      const replaced: CToken[] = [];
      for (let i = 0; i < body.length; i++) {
        if (body[i].text === '__VA_OPT__') {
          const args = macroArguments(body, i + 1);
          if (args) { if (nonempty) replaced.push(...args.values.flatMap((v, n) => n ? [{ ...invocation, text: ',' }, ...v] : v)); i = args.end - 1; continue; }
        }
        if (body[i].text === ',' && body[i + 1]?.text === '##' && body[i + 2]?.text === macro.variadic) {
          if (nonempty) replaced.push(body[i], body[i + 2]); i += 2; continue;
        }
        replaced.push(body[i]);
      }
      body = replaced;
    }
    let variants = [{ args: new Map<string, CToken[]>(), conditions: branches.map(branch => branch.condition), branches }];
    for (const [name, tokens] of raw) {
      const used = body.some((token, i) => token.text === name && body[i - 1]?.text !== '#' && body[i - 1]?.text !== '##' && body[i + 1]?.text !== '##');
      const next: typeof variants = [];
      for (const variant of variants) for (const choice of used ? this.expand(tokens, nesting + 1, variant.branches) : [{ tokens, conditions: [], changed: false, branches: variant.branches }]) {
        if (next.length >= 32) { this.issues.add('Macro argument alternative limit: 32 candidates'); break; }
        next.push({ args: new Map(variant.args).set(name, choice.tokens), conditions: [...variant.conditions, ...choice.conditions], branches: choice.branches });
      }
      variants = next;
    }
    return variants.map(variant => {
      const result: CToken[] = [];
      for (let i = 0; i < body.length; i++) {
        const token = body[i];
        if (token.text === '#' && raw.has(body[i + 1]?.text)) {
          const argument = raw.get(body[++i].text)!;
          const text = argument.map((part, n) => (n && part.space ? ' ' : '') + part.text).join('');
          result.push({ ...invocation, text: JSON.stringify(text) }); continue;
        }
        const argument = raw.get(token.text);
        if (argument) {
          const pasted = body[i - 1]?.text === '##' || body[i + 1]?.text === '##';
          const parts = pasted ? argument : variant.args.get(token.text)!;
          result.push(...(parts.length ? parts : [{ ...invocation, text: '' }]));
        } else result.push(token);
      }
      for (let i = 0; i < result.length; i++) if (result[i].text === '##') {
        const left = result[i - 1], right = result[i + 1];
        if (!left || !right) { this.issues.add(`Macro ${macro.name}: invalid token paste`); continue; }
        const text = left.text + right.text;
        const pasted = tokenizeC(text, () => invocation.location);
        if (text && (pasted.length !== 1 || pasted[0].text !== text)) this.issues.add(`Macro ${macro.name}: invalid token paste ${text}`);
        result.splice(i - 1, 3, { ...invocation, text }); i -= 1;
      }
      return { tokens: result.filter(t => t.text !== '').map(token => ({ ...token,
        invocation: invocation.invocation ?? invocation.location,
        hidden: [...new Set([...(token.hidden ?? []), ...(invocation.hidden ?? []), macro.name])],
        chain: [...(invocation.chain ?? []), { name: macro.name, location: macro.location }, ...(token.chain ?? [])]
          .filter((frame, i, chain) => chain.findIndex(f => f.name === frame.name && f.location.uri === frame.location.uri && f.location.start === frame.location.start) === i) })),
        changed: true, conditions: variant.conditions, branches: variant.branches };
    });
  }
}
