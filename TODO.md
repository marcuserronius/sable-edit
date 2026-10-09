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
- DONE (stage 1): clicking the selected shape toggles scale <-> rotate/skew only; edit mode is entered by double-click, long-press (touch/pen)
  or `ed.edit()`, and left with Esc (edit -> scale -> deselect). Nothing waits for a possible double-click any more.
- Stage 2: merge edit mode into the tools, so the "create X" tool is also the "edit X" tool (a double-click arms the shape's own tool on it):
  - Needs the pen tools first (path, polygon, polyline): a tool that lives past one press-drag-release, click-to-add-nodes, finish on
    Enter / double-click / Esc; the same lifecycle change the merge needs
  - Decide sticky vs once: if tools were sticky by default (stay armed, Esc to leave), "once" is just a flag that leaves the tool after one
    object; the editor would attach to the object just made either way, so the double standard may not be worth it
  - Press on an object of the tool's own type edits it; anywhere else creates (so a new rect can't start on top of an existing rect)
  - Create and edit stay separate permissions (a host may allow editing existing paths but not drawing new ones)
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
    - A node between a line and a curve has no type: tangent alignment with an
      adjacent L (and arcs) is part of the segment-conversion work below
    - Quadratic controls hang off two nodes: links apply at both, but only
      T-flagged chains cascade
    - Dragging the start node of a closed path doesn't move the coincident end
      node (pre-existing); it should, along with its handles
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
  