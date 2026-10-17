# 0.1.6 verification — 2026-10-17

- Browser regression failed before the fix: the popup was visible before the one-second dwell elapsed.
- Browser regression passed after the fix: hidden at 650 ms, pointer movement within the node resets the wait, leaving cancels the pending popup, clicking does not open it immediately, and Space still opens details immediately.
- Distinct popup colors verified for symbol name, location and reference kind in dark and light themes. Conditional expressions use C syntax colors.
- Existing Context click, hover-popup layout, keyboard expansion, Escape/Tab, candidate selection, and narrow-layout checks passed.
- Type checking passed. Packaged and installed 0.1.6.
- Preview screenshots: output/playwright/relation-hover.png and output/playwright/relation-hover-light.png.
