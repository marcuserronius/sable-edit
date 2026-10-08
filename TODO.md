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


# Future improvements:
- path editor:
  - Implement selection of segments and nodes (should pertain to polygons and 
    polylines as well)
    - Implement deletion of selected segments and nodes via delete/backspace
    - Only display handles that pertain to selected nodes or segments
  - Handling of symmetric/partially symmetric node handles:
    - If handles are fully symmetric (same length, and lying on the same line 
      with the node), use the smooth variant of the command, S/s and T/t
      - This should be easy. If they are made symmetric (by holding shift), 
        convert them to the smooth variant, and continue to treat them that way
    - If handles are partially symmetric (different lengths, but lying on the 
      same line with the node), lock them to remain at the same relative angles
      when editing.
    - Determine a good way to allow symmetric handles to become corner handles
      - Context menu toggle?
      - Shift reverses current behavior instead of just making them snap?
  - Auto-convert between H/h, V/v, and L/l, changing to most efficient one when
    changes are made
    - Other segments keep their type unless explicitly changed.
  - Context menu click on segments offers to change segment type
    - When changing between curve types, calculate best fit from old curve
      - Simple in the case of quadratic to cubic, others will approximate
    - When changing from a straight line to a curve:
      - Beziers will turn into a straight line with extended handles; quadratics
        with their handles at the midpoint, cubics probably should be at either 
        the 1/3 and 2/3 points, or 1/4 and 3/4 points
      - A straight arc has its centerpoint at infinity, so it should be turned 
        into a curve
        - If possible, make the curve tangent to nearby line segments
        - If not possible or infeasible, choose a reasonable default value to 
          set it at
          - Perhaps something like a 1 radian arc?
- Implement conversion of objects to other types
  - Simple: rect, circle, ellipse, polyline, polygon => path
    - Just convert directly, using best options for straight lines and curves
  - Obvious choices to get close for other conversions:
    - ellipse to rect: round the corners
    - rect to ellipse: w/h => xr/yr (divided by 2, of course)
    - rect, ellipse to circle: Equal area? Average w/h or xr/yr?
    - path to polygon/polyline: 
  - Difficult conversions: do we even bother?
    - paths/polylines/polygons to circle/ellipse/rect
      - Maybe differentiate between converting and restructuring (better terms?)
        - One takes a simplistic view, and makes a new shape with approximately 
          the same dimensions, only exact for types that always directly 
          convert, like rect => path; where path => rect just makes rect with 
          the bounds of the original path
        - The other makes an attempt at precision: a path that is close to a 
          rect gets converted heuristically, and applies transforms like 
          rotate, scale, and skew to make it as close as possible
          - This is significantly harder work, so it can be a far future option
- Implement low-level and numeric editing
  - Some of this might be blocked by the "security" policies
  - Direct changing of derived numeric values like height, width, position, etc
    - Position relative to corners, edges, or centers of bounding box.
  - Direct editing of attribute values, ie. rect gives fields for x1, y1, etc.
  - Direct editing of xml for a particular tag
  - Important: editing of class and id tags
- Implement `use` tags
  - Must-have feature: proxy editing through the use tag
    - The tool for editing `use` objects redirects automatically to the 
      appropriate tool for editing the "used" (aka referenced) object
  - Context menu option to break the link, and replace the `use` object with the
    object it is using
  - Context menu item to reveal the original
    - If it's in `defs`, what do we do there?
- Implement group tags (`g`)
  - Some way of entering the group for editing
  - When you enter the group, everything else is deemphasized
    - Defocus? Cover with half-opacity grey? Unsure
- `defs` tag:
  - Can you have more than one?
  - How to make editing the objects inside it work?
    - Just dump them all on the screen at once, and deemphasise everything else 
      like a `g` object?
    - Pick each object out one at a time for editing?
- Hiding and showing objects
  - Pretty importnant feature for editing, sometimes too much clutter gets in 
    the way and needs hiding
  - Use attributes/styles to actually hide items?
    - Probably, but explore other options that would only hide while in edit 
      mode, but they stiill show when exported or saved.
- Editing stroke and fill:
  - May be blocked by policies
  - Color palettes? Color variables from CSS?
  - Patterns, gradients and other generated images subbing for colors
  - Dashed lines
  - Line markers, such as arrows
  - Miters and caps
- Text tool
  - Figure out how to define features for it
  - Look into `tspan` and `textpath`
- Quick tools: are they in scope?
  - Flip (horizontal, vertical, arbitrary angle)
  - Rotate; 90° left, 90° right, 180°
- Grids?
  - Grid snapping
- Viewport editing
  - Goes along with document height and width
  - should this essentially be a `svg` tool?
  