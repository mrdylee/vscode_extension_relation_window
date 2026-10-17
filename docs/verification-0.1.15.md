# v0.1.15 verification

The reported WSL machine and its project were not available locally. These checks address confirmed algorithmic bottlenecks without claiming to reproduce that machine's complete runtime state.

## Regression checks

- Before the incremental change, updating a new file triggered a guarded getter on an unchanged file (`unchanged symbols scanned`). After the change, update, replace, remove, and missing-file removal leave unrelated records untouched.
- Before candidate caching, 400 call sites with 20 shared prototypes read prototype definition flags 8,400 times. The regression now passes below 1,000 accesses while preserving all 400 sites.
- Before exclusion handling, the extension indexed 94 fixture files instead of the expected 93. Initial scans, file creation, unsaved edits, and live exclusion changes now pass.
- 36 unit tests pass. Browser interaction and real Extension Host checks pass.
- Compared 2,828 depth-3 graphs with v0.1.14 across 80 deterministic updates/removals. Inputs included static/global conflicts, conditional definitions, callback parameters, address tables, header includes, and block externs. All graphs matched, including candidate and site ordering.

## Local performance samples

macOS, Node 22.22.2; single-run synthetic measurements, not portable timing guarantees.

| Workload | Result |
| --- | --- |
| 40,000 same-name references, index insertion | about 3.5 ms (earlier full-copy implementation: about 1,683 ms) |
| 12,500 synthetic analysis records / 125,000 references | about 12.6 ms total index-update time, excluding fixture construction and parsing |
| One 20-reference edit in that index | about 0.05 ms |
| Actual Extension Host, 12,551 source files with 10,050 tool headers excluded | 2,501 files indexed; 50,000 call sites verified |
| Large Extension Host run | 1,615 ms total; selection response 101 ms while 491 files had been indexed |
| 50,000-site caller query | 22 ms |
| Largest observed 20 ms heartbeat interval, including caller query | 42 ms |
| Full FreeRTOS tree | 655 files, 3,404 ms; no background editor documents opened |
| FreeRTOS automatic selection at depth 3 | 98–133 ms for four function/variable selections |

The intermediate version with incremental updates but without prototype caching still produced an unresponsive-host report on the large caller query. Candidate caching removed that observed stall in the subsequent local run. Remaining index and query work runs on the extension host; parsing remains in the existing Worker. Arbitrarily large graphs or individual source files can still be expensive.

## Repeatable checks

`npm run typecheck`, `npm test`, `npm run test:performance`, `npm run test:extension`, `npm run test:large`, `npm run test:ui`, and `npm run test:freertos`.

The release workflow runs type/unit/performance checks plus the regular and large Extension Host suites on Windows, macOS, and Ubuntu. Local raw outputs are saved under ignored `test-results/`.
