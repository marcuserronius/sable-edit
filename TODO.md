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
- Bounds: new shapes from every tool are fitted to the bounds and the snap grid as they are drawn; bounds are in the parent's coordinate
  system only (a `space: 'root'` option would help hosts whose shapes sit in translated groups); bezier handles count as nodes, which is
  stricter than the curve itself (a looser mode could clamp the true curve extent); stroke width isn't counted; scale / rotate / skew
  are refused at the wall rather than clamped; a bounded `g` is measured with getBBox (children's transforms included).
- Ranges on a scale factor (a `transform` write): bounds cover the effect, but there's no min/max size for scale mode as such.
- Markup: a restrict-only mode (markup may take capabilities away but never grant), for content that is partly user-authored; a `data-sable-policy` change on the selected shape rebuilds its handles now only on reselect.
- Per-element `element.delete` / `duplicate` / `reorder` once the widget has UI for them; per-arc / per-rect-radius capabilities if wanted.
- Pin anchor position versus tangent: only the node's position is pinned today, its bezier handles stay free.


# Future improvements:
- DONE (stage 1): clicking the selected shape toggles scale <-> rotate/skew only; edit mode is entered by double-click, long-press (touch/pen)
  or `ed.edit()`, and left with Esc (edit -> scale -> deselect). Nothing waits for a possible double-click any more.
- Stage 2: merge edit mode into the tools, so the "create X" tool is also the "edit X" tool (a double-click arms the shape's own tool on it):
  - Needs the pen tools first (path, polygon, polyline): a tool that lives past one press-drag-release, click-to-add-nodes, finish on
    Enter / double-click / Esc; the same lifecycle change the merge needs
    - DONE (pen stage 1): the path pen (`src/pen-math.js`, the path widget's pen mode, `pen:true` tools in attach.js). Also DONE: the polygon and polyline pens (a polygon inserts the new vertex after the selected vertex; a polyline continues from either end)
    - Pen follow-ups: Shift to constrain the angle; a drag at the closing node doesn't yet smooth the joint with the first segment's handle
      ("extend but not create" and starting a path on top of a stroke, with Alt, are done)
  - DONE: sticky vs once decided: every tool is sticky; the use-once code and `ed.useTool` are gone
  - DONE (Stage 2, part 1): press on an object of the tool's own type edits it; anywhere else creates (a rect, circle, ellipse or line: its body; the pens: its
    stroke, with Alt to draw on top of one anyway); a created shape is selected, in edit mode, with the tool still armed
  - DONE (Stage 2, part 1): create and edit are separate permissions: `create` governs drawing (`ed.tools[i].create`), a tool arms to edit while a shape of
    its kind can be edited, and a pen can extend a path without being allowed to start one
  - DONE (Stage 2, part 2): a double-click / long press / `ed.edit()` / `ed.mode='edit'` arms the shape's own tool, so edit mode and the tool are one
    state (`ed.mode='scale'|'rotate'` or Esc leave it); a click that draws nothing selects a shape of another kind or deselects; the one-gesture tools snap
    and clamp to the policy like the pens do. The pens' close / finish gestures only apply while drawing (once a node has been added)
  - Follow-ups: a shape with an edit widget but no tool (a host's own) still uses the plain edit flag; hover cursors for armed tools on touch; the
    pen's "click the end node to finish" could show a ring on hover
  - `ed.mode = 'edit'` and the `mode` event keep working, reporting edit while an edit tool is active
- path editor:
  - DONE (paths: nodes and segments; polygons/polylines: nodes only): selection
    of segments and nodes, deletion via delete/backspace, handles shown only for
    the selection. Open follow-ups:
    - Polygon/polyline edges aren't selectable: cutting one splits the element
      in two, which needs the element creation/conversion work below
    - Marquee (rubber-band) selection and select-all (Ctrl+A)
    - A 'selection' event so host UIs can enable a Delete button without polling
    - Cutting a segment is refused when the shape has any pin (it renumbers
      nodes); revisit with the pin reassessment above
    - Clicking the stroke now selects a segment; mode switching on an unfilled
      path is a second click on the selected segment (or Escape, then click the
      fill). Reconsider once a context-menu mode switch exists
  - DONE: handling of symmetric/partially symmetric node handles. Type is
    inferred from the geometry (corner / smooth / symmetric); symmetric pairs
    made by Shift-drag or the node menu are flagged and written as S/T; smooth
    pairs keep their angle; Alt-drag or Node type > Corner breaks the link.
    Open follow-ups:
    - DONE: nodes between any segment types have a type (tangent alignment decides it where a side has no handle) and Node type works on
      them (`src/node-type.js`): the side that gives way is converted (see README); arcs only ever become one best-fit cubic, so no node is
      ever added, apart from a closing line made explicit. Follow-ups: Symmetric between an arc and a line can't copy the arc's radii (the
      circle through the node, the far end and the tangent is fixed), so it makes the unique tangent circular arc; handles lie on the average of the two tangents (arcs stay as they are), a missing / retracted one getting half its segment's length; a big arc turned into a
      single cubic is only roughly the same shape; a pin on the node is not specially handled
    - Quadratic controls hang off two nodes: links apply at both, but only
      T-flagged chains cascade
    - DONE: a subpath whose last point sits on its first has one *joined* node there (a Z that draws no line, or no Z at all: files leave it out):
      one square, selecting / dragging / deleting it takes both halves with their handles, and its handles pair up across the joint like any
      node's. A Z that really draws a line stays a segment of its own and the nodes at its ends are independent (`twins` in `src/path-math.js`)
    - Node-type shapes (rounded = smooth, round = symmetric) are a first guess
  - DONE: H/V/L auto-conversion (a segment an edit touches is rewritten as
    H, V or L, whichever fits; the rest keep their command) and the Segment
    type menu (L/Q/C/A; line to cubic puts the handles at 1/3 and 2/3, to
    quadratic at the middle; line to arc is tangent to the previous segment,
    else a 1 radian arc). Open follow-ups:
    - Commands are always written absolute, so the choice is only H/V/L, never
      the relative h/v/l that might be a few characters shorter
    - The closing line of a closed path (Z) can't be converted; do that by
      turning it into an explicit L first
    - A line made into a curve isn't made tangent to its neighbours (only the
      arc case is), and the arc only looks at the segment before it
    - Arc to cubic/quadratic can add nodes (an arc of more than a quarter turn
      becomes several curves), so it needs nodes.insert
- DONE: conversion of objects to other types (`src/convert.js`; right-click > Convert to, `ed.convert()`)
  - Every shape (line too) => path, always exact: lines become H/V/L, circles and ellipses four quarter arcs (`arcs:false` gives cubics),
    rounded rect corners arcs. Arcs rather than cubics because they are exact and the path editor already handles them.
  - Plan changes: ellipse => rect needed no corner guessing: a rect with rx = w/2, ry = h/2 IS the ellipse, so it is exact (and rect =>
    ellipse is exact exactly when the corners are fully round). rect/ellipse => circle keeps the AREA (r = sqrt(rx * ry)): it is
    symmetric in the two radii and a square stays a square's circle. polygon <=> polyline, path => polygon/polyline (curves flattened
    within a tolerance that scales with the shape), path/polyline/polygon => line (only when it already is one segment), and any
    shape => polygon/polyline went in as well, all through the path as the pivot.
  - Where the geometry really is the target it is recognised, so these are exact and round-trip: a path that is an axis-aligned
    rectangle => rect, a path of arcs once round one centre => ellipse / circle. Everything else is the simplistic bounding-box
    version, marked "(approx.)" in the menu.
  - A new tag is a new element: built beside the old, judged by the policy in its place (new capability element.convert, in 'all';
    `checkConvert()` in `src/policy.js`), then swapped, as one undo step with a 'convert' event. The selection and its mode carry over.
  - Not done / ideas:
    - The "restructuring" version: rounded rects (L A L A ... Z) back into rect with radii, rotated / skewed rectangles and ellipses
      recognised by adding a `transform` (needs the policy's transform.* too), regular polygons, circles from many-sided polygons.
    - Convert for touch (a long press is edit mode; ed.convert() / convertTargets() are there for a host's own button).
    - Several subpaths => polygon/polyline is refused (they hold one outline); splitting into several elements needs the
      element creation work above.
    - Convert a whole multi-selection once there is one. Style set through CSS geometry properties (r, rx, d...) is not looked at.
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
  