# review-work: Combined Full width

The user requested a clearly named Settings choice in addition to Combined.
`combined-full-width` is the third supported value, with native Settings label
**Combined · Full width** and English descriptions explaining the shared Panel
alignment with Terminal. Existing Combined default and Separate registration stay
compatible. No analyzer, source scope or inference code changes. Prior pin-marker
changes remain in the unpublished v0.1.35 bundle. No review subagent.

Local review checked that layout commands execute only on layout changes and main
view resolution. Full width applies Bottom followed by Justify, with a preference
recheck after the awaited position command. Leaving full width applies Center.
Sorting, direction and analysis updates do not repeatedly alter panel alignment.
Command failures produce a visible extension error. The webview already treats
every non-Separate layout as Combined, so no new rendering implementation is needed.

Fresh typecheck/build, existing browser suite and native Extension Host suite pass.
An isolated native VS Code profile also verified five phases: saved full-width
startup, Combined, Full width, Separate and Combined again. Native Settings showed
all three labels with the correct selection. Real workbench DOM geometry measured
full-width panels at 1384 px versus a 788-px editor with both sidebars visible;
Combined and Separate restored a 788-px panel. Pin state, graph contents and parsed
file object identity survived every transition. Screenshots and geometry reports
are under ignored `output/playwright/native-layout-*` and `test-results/full-width.json`.
The initial smoke assertion was corrected for the installed modern UI's 4-pixel
panel gutters; the screenshot and geometry already showed correct full width.

No blocking findings remain in this local review. Tests ran on macOS, not a new WSL
or Windows end-to-end run. No user-profile layout was changed: native checks used
temporary isolated profiles. No remote push, release or installed-extension change.

Final local package: `artifacts/c-relation-explorer-0.1.35.vsix`, 514301 bytes.
SHA-256: `522940e6714d8d27ef8a6c8247ce21c400e8f11b191cc62a21ee8bafc779aa6d`.
ZIP inspection verified manifest version, labels, shared-panel descriptions,
native layout command IDs, pin marker, offline Help and byte equality of bundled
extension/webview payloads to the verified build.
