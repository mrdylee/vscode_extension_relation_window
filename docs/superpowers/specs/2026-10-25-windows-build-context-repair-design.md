# Windows batch and Make context repair

User authorization: implement, test and publish; include GCC. Baseline 0.1.77.
The private firmware is available as photographs only. Synthetic acceptance is
not a claim of validation against that firmware.

## Choice

Extend bounded, read-only static extraction. Executing Make or scripts could
write files and is excluded. Merely clearing `unknown` would fabricate evidence.
Importing build logs is a separate feature and does not repair existing discovery.

## Data and behavior

- Interpret cmd environment names case-insensitively, PATH assignments, direct
  batch transfers and `call`. Direct batch transfer ends the caller. Never execute
  commands. Statically model literal metadata deletion/echo redirection in an
  overlay; dependencies retain the original disk digest for invalidation.
- Preserve compile facts established before unsupported postprocessing. Unknown
  commands preceding compilation remain conservative. Do not blindly skip arbitrary
  generators or treat their output as known. Cleanup, waits and terminal pauses
  do not establish preprocessing inputs. Diagnostics retain provenance.
- Implement balanced Make expansion for bounded pure list/path/string functions,
  substitution references, define blocks and command variable overrides.
  Only explicitly recognized read-only shell expressions may be evaluated in JS;
  never run a shell. Unknown expressions remain unknown.
- Resolve target-specific variables and their inherited effects per invocation,
  pattern rules, automatic variables and order-only prerequisites. Do not merge
  module flags or count image packaging as source compilation. Generated header
  recipes remain explicit unavailable artifacts when they cannot be evaluated.
- Apply ordered verified GCC/Diab `-D`, `-U`, `-I` options. Retain uncertainty for
  unsupported target/compiler/preinclude/response semantics. Unknown options must
  not permit unsafe preprocessing pruning. GCC is the same acceptance path.
- Keep overall link coverage partial. Distinguish compile inclusion from unknown
  options and final link membership. Keep all existing analysis limits unchanged.
- Make diagnostics show location/expression and actionable uncertainty. Refresh,
  warm metadata and persisted analysis must not reuse old semantics.

## Acceptance and delivery

Failing-first tests cover batch transfer/call, metadata overlay, environment case,
target-specific module defines, nested Make functions/define blocks, generated
artifacts, postprocessing versus unknown pre-build commands, GCC/Diab options,
cache changes and contextual callback choices. Preserve genuine unsupported and
resource-limit cases. Run full unit, Worker/cache, memory, typecheck/build, UI,
native Extension Host and large-workspace gates. Package and inspect a patch VSIX;
publish through unchanged Windows/macOS/Linux CI. Verify public files/checksums
and updater. Never move a failed/published tag.
