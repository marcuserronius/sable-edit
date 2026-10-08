# TODO

## Permissions: reassess "a pin turns transforms off"
Today any `pin` on a shape (path, polygon, polyline, line) removes that shape's `transform.*` capabilities, because a move, scale or
rotate would carry the pinned node with it, and a pin by index also removes `nodes.insert` / `nodes.delete` because indices would shift
(see `finish()` in `src/policy.js`). This was chosen as the simple option for now.

Revisit: let a pin hold in *canvas* coordinates while transforms stay allowed but constrained: a scale, rotate or skew that would
move a pinned node is refused or clamped, so for a pinned shape the allowed transforms shrink to those that fix every pinned point
(a move never qualifies). More flexible, a lot more work.

## Permissions: not done yet
- Snap: a grid origin offset (the grid is anchored at 0,0 of the shape's own coordinates); a user-held modifier to bypass it is deliberately absent (snap is a constraint, not a preference, so a host who wants a convenience grid for users needs a separate, non-policy option); a mirrored bezier handle (Shift-drag) snaps independently of its partner, so exact mirroring can be off by up to half a grid step; transforms other than moves (scale, rotate, skew) aren't snapped.
- Bounds: new shapes from the creation tools aren't clamped as they're drawn (the first edit after is); bounds are in the parent's coordinate
  system only (a `space: 'root'` option would help hosts whose shapes sit in translated groups); bezier handles count as nodes, which is
  stricter than the curve itself (a looser mode could clamp the true curve extent); stroke width isn't counted; scale / rotate / skew
  are refused at the wall rather than clamped; a bounded `g` is measured with getBBox (children's transforms included).
- Ranges on a scale factor (a `transform` write): bounds cover the effect, but there's no min/max size for scale mode as such.
- Markup: a restrict-only mode (markup may take capabilities away but never grant), for content that is partly user-authored; a `data-sable-policy` change on the selected shape rebuilds its handles now only on reselect.
- Per-element `element.delete` / `duplicate` / `reorder` once the widget has UI for them; per-arc / per-rect-radius capabilities if wanted.
- Pin anchor position versus tangent: only the node's position is pinned today, its bezier handles stay free.
