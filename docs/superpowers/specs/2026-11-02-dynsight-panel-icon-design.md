# Dynsight panel icon

The user requests a panel icon with a strong Dynsight identity. Treat this as
the existing panel-container icon, rather than a redesign of navigation symbols
or toolbar actions. Keep its existing manifest path, `media/relation.svg`.

Use a rounded D outline containing three connected, filled nodes. The D gives
the product a recognizable initial; the nodes represent call relationships.
An eye alone resembles a generic visibility action, while a graph alone repeats
the current generic icon. Use the D/graph combination as the chosen direction.

Keep the 24×24 viewBox and `currentColor`. Preserve a transparent background and
use simple, consistent strokes and filled nodes so the mark remains legible
at 16px. No text, gradients, animation, fixed brand color or new dependencies.

Acceptance: inspect 16px/24px renderings on light, dark and high-contrast surfaces;
verify the existing manifest reference and packaged SVG. Build and typecheck must
pass. This is a reversible static asset change; no new behavioral tests are needed.
Keep completed work integrated on main under the user's existing instruction.
