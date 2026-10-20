# Callback limit attribution and initialization cost

Checkpoint: checkpoint/pre-callback-limit-diagnostics-20261020 at 1c68775,
pushed before edits. User approved improving diagnostic attribution and checking
unnecessary tracking, while preserving existing safety budgets.

Keep generic limit messages for incomplete-result semantics. Add bounded callback
diagnostic records to file analyses with reason, stage, current source location,
function/initializer symbol, elapsed project/function time and evaluation counts.
Attach located warnings to their actual file; display project-wide warnings with
no arbitrary source-file prefix. Treat a deadline location as the observation
point, not proof that this function consumed the whole project budget. Record at
most 64 distinct reason/symbol/stage observations; retain a project summary for
any limit without a retained detail. No source content or identifiers enter the
public report: include only the allowlisted kind/stage and numeric cost counters.

Put limit warnings before ordinary syntax warnings so the existing first-100
notice display cannot bury the useful diagnosis. Keep reports and UI bounded.

A narrow cost candidate is global initializer state.effects: summaries from this
state are never consumed, but write currently fills/caps it as if it were a
function. Reproduce the spurious 256-slot warning with a large static initializer;
skip only these unused global effects while preserving all heap writes, local
static mutations, real function effect summaries and callback candidates.

Do not increase 10-second, 256-slot, candidate, loop or memory limits; do not add
whole-program slicing or selective callback analysis without evidence. Private
WSL code is unavailable, so verify reconstructed fixtures and label remaining
performance/root-cause uncertainty. Review, package and publish through existing
platform CI and asset verification.
