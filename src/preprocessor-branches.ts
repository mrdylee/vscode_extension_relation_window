import { MacroBranch } from './model';

export function combineBranches(left: readonly MacroBranch[], right: readonly MacroBranch[]): MacroBranch[] | undefined {
  if (!left.length) return [...right];
  if (!right.length) return [...left];
  const result = new Map(left.map(branch => [branch.key, branch]));
  for (const branch of right) {
    const previous = result.get(branch.key);
    if (previous && previous.value !== branch.value) return;
    result.set(branch.key, branch);
  }
  return [...result.values()];
}

// Keep the old definition only where the later conditional update does not run.
export function outsideBranches(current: readonly MacroBranch[], update: readonly MacroBranch[]): MacroBranch[][] {
  if (!update.length) return [];
  const known = new Map(current.map(branch => [branch.key, branch.value]));
  // An incompatible update cannot replace this definition. Conditions already
  // implied by the current path need no complementary alternatives.
  if (update.some(branch => known.has(branch.key) && known.get(branch.key) !== branch.value)) return [[...current]];
  const result: MacroBranch[][] = [];
  const prefix = [...current];
  for (const branch of update) {
    if (known.has(branch.key)) continue;
    const condition = branch.condition.startsWith('else of ') ? branch.condition.slice(8) : `else of ${branch.condition}`;
    result.push([...prefix, {...branch, value: !branch.value, condition}]);
    prefix.push(branch);
  }
  return result;
}
