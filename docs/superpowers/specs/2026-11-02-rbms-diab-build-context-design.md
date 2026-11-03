# RBMS Diab build context repair

Use the RBMS Diab 5.9.6.7 build inputs as the representative compatibility case.
The repair changes static extraction only; build tools and generators remain unexecuted.

## Pattern selection

The RBMS C rule lists overlapping generic, product and shared object prefixes.
Enumerate every matching target pattern, prefer the shortest stem, and select a
candidate whose prerequisites exist, have an explicit build rule, or are explicit
prerequisites of the target being evaluated. Implicit rule stems must be nonempty;
Make text functions retain their existing empty-match behavior. Use indexed
source URIs and cached directory listings, without reading C source bodies.
When several candidates remain unverified, retain an explicit partial result.
Directory observations participate in metadata invalidation.
Deduplicate identical patterns and charge candidate matches to the existing work
budget. Keep exhaustion visible even when artifact notices fill the 128-notice cap.
Directory-less patterns match target basenames and restore directories only to
prerequisites containing `%`; `$*` retains its directory. Parent-folder changes
invalidate descendant directory observations and included metadata, using canonical
cache keys for Windows drive spelling and path case.

## Compiler options

Recognize the exact target, diagnostic, dependency, code-generation and dialect
option forms observed in the four RBMS compiler flag groups. Preserve ordered
explicit defines and include paths. Keep compiler builtins and default includes
unknown, and keep unrecognized option forms partial.
Collect C inputs separately from option values and response-file names, retaining
one context per source. Repeated multi-input normalization consumes the existing
extraction budget. Unresolved target-specific appends on simple variables remain
partial rather than supplying incomplete macros to branch pruning.

The Wind River-authored PowerPC 5.4 manual documents the option families:
https://bitsavers.trailing-edge.com/pdf/windRiver/Compiler_5.4_2007/wr_compiler_users_guide_ppc_5.4.pdf
The checked-in RBMS flags establish the observed 5.9.6.7 forms. This is bounded
option extraction, not a compiler-version or firmware-equivalence claim.

## Validation and boundaries

Cover overlapping patterns, unavailable prerequisites, metadata invalidation,
four option groups and cold/warm/configuration-edited callback analysis.
Version generators, generated headers and final link membership remain uncertain.
Do not change scopes, settings, AI behavior, the GCC option adapter or unrelated
Make/shell features. Bump the extraction version so old build contexts cannot persist.
