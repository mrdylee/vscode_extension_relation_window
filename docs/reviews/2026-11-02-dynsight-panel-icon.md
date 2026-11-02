# Dynsight panel icon

Replace the generic three-box relation diagram in `media/relation.svg` with
a D outline and three connected nodes. The existing panel-container manifest
reference is retained. The 24×24 SVG uses currentColor and a transparent background.

Reviewed actual browser CSS-mask renderings at 16px and 24px on dark, light and
high-contrast surfaces. The D outline and graph remain distinct, with no clipping.
Build, typecheck, SVG XML parsing and diff whitespace checks passed. The local
preview VSIX contains the exact source SVG and the same manifest icon reference.
SVG SHA-256: `4fd11327d9c95b8912360e57cb6e8c3c6aba7c3e330effdeca3ef76ed9fbc2fb`.

Ignored local evidence: `output/playwright/dynsight-panel-icon/comparison.png`
and `artifacts/dynsight-panel-icon/verification.json`. The packaged preview is
`artifacts/dynsight-panel-icon/dynsight-0.1.93-panel-icon-preview.vsix` (764,951 bytes).
This is an asset-only update on main, with no version or analysis-cache bump.
A new public release, active-user VSIX installation and window reload were not
performed as part of this icon change.
