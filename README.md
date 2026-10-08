# SableEdit

Drop-in SVG element editor (paths first). No runtime dependencies.

Press a shape to select it. Drag anywhere on the selected shape to move it; click or tap it again without dragging to cycle through three edit modes: **scale**, **rotate/skew**, and **edit** (the shape's own controls). The handles show which mode you are in.

**Creating shapes:** right-click (Ctrl-click on a Mac) anywhere on the canvas for the context menu. **Use Once** arms a tool for a single shape and then returns to the pointer; **Switch Tool** keeps it until you choose Pointer (or press Esc). Built-in tools: **circle** (press for the centre, drag out to the radius), **rectangle** (press one corner, release on the opposite one), **ellipse** (the same, for its bounding box) and **line** (press the start, release at the end). The menu is the only UI the widget needs, so it works in pages with no toolbar; `ed.tool`, `ed.useTool(id)` and `ed.addMenu(fn)` are there for hosts that want their own.

## Permissions
By default every shape matching `selector` is fully editable. Pass a `policy` to say exactly what a viewer may do to which shape. Nothing is allowed until a rule grants it, and later rules override earlier ones:

    SableEdit.attach(svg, { policy: [
      { select: '.logo',  can: ['geometry.edit', 'attrs.edit'], attrs: { deny: ['stroke*', 'style'] } },  // reshape it, but not stroke or style
      { select: '.curve', can: ['geometry.edit', 'nodes.*'], pin: ['endpoints'] },                         // any node but the ends
      { select: '.fixed', can: ['transform.*', 'geometry.edit'] },                                         // no adding or deleting nodes
      { select: '#bg',    can: [] },                                                                       // not selectable
      { select: '.card',  can: 'all', bounds: { x: 0, y: 0, width: 600, height: 400 },                     // keep it on the card,
        ranges: { r: [5, 50], 'stroke-width': [1, 8] } },                                                  // and keep sizes sane
    ]});

Capabilities: `transform.move|scale|rotate|skew`, `geometry.edit` (the edit mode), `nodes.insert|delete`, `attrs.edit` (fill, stroke, style, class... narrowed by `attrs.allow` / `attrs.deny` globs). `pin` locks nodes (`'endpoints'` or indices) and, because moving or scaling would drag a pinned node along, turns that shape's transforms off. Disabled modes and handles aren't offered, and every write is checked too, so `ed.set()` is held to the same rules (`ed.set(el, attr, val, src, { force: true })` is the escape hatch for host code; `ed.can()` / `ed.canSet()` let a host grey out its own controls; `onDenied` / `ed.on('denied')` report refusals). `bounds` is a box in the shape's parent coordinates that its nodes (a path's anchors *and* bezier handles, a polygon's vertices, a rect's corners, an ellipse's extent) may not leave: a dragged node stops at the wall and slides along it, a move stops at the wall, a resize keeps its far edges, and a scale or rotation that would cross it is refused. `ranges` clamp numeric attribute values (`r`, `width`, `stroke-width`, and the same properties inside `style`). `snap` puts whatever an edit moves on a grid (`snap: 10`, or `[10, 5]` for x and y): path anchors and bezier handles, polygon vertices, rect edges, line ends and circle/ellipse centres and radius edges. It acts on the stored numbers, only on what the edit changes, and moves a shape (or a node together with its handles) by one amount, so curves aren't bent; it is forced, not a toggle. Order of precedence: snap, then pins, then ranges, then bounds. `ed.range()` / `ed.bounds()` / `ed.snap()` tell a host UI the limits, and `ed.setMany()` writes several attributes as one checked, undoable step. The policy guards the person using the widget, not the page: for a real guarantee run `checkWrite()` from `src/policy.js` (pure, Node-safe) on the server. See the header comment in `src/banner.txt` for the full rule syntax.

### Permissions in markup
For a static page with no JS config, write the rules on the shapes themselves and list `'markup'` in the policy (`policy: 'markup'`, or `policy: [{ select: '.edit', can: 'all' }, 'markup']` to mix with rules; later entries win):

    <svg ... data-sable-policy="transform.move">                      <!-- default for the whole drawing -->
      <path data-sable-policy="geometry.edit, nodes.*; attrs-deny: stroke*, style; pin: endpoints" .../>
      <g data-sable-policy="geometry.edit; -nodes.delete; bounds: 0 0 600 400"> <circle data-sable-policy="range: r=5..50" .../> </g>
    </svg>

Clauses are separated by `;`: bare words grant capabilities (`-name` takes one away; `can:` / `cannot:` spell it out), `attrs-allow:` / `attrs-deny:` (globs), `pin:`, `bounds: x y width height`, `range: name=min..max` (either end may be empty), `snap: 10` or `snap: 10 5`. Declarations on a `<g>` or the `<svg>` cover what's inside, and the nearest one wins. Markup is only read when `'markup'` is in the policy, so SVG uploaded by your users can't grant itself powers: enable it only for markup you wrote. A typo throws when the editor attaches. The attribute can't be changed through the editor itself.

## Using it
Plain script tag (defines `window.SableEdit`):

    <script src="dist/sable-edit.js"></script>
    <script>const ed = SableEdit.attach(document.querySelector('svg'));</script>

ES module:

    import { attach } from './dist/sable-edit.esm.js';

`dist/sable-edit.min.js` is the minified script-tag build. See the header comment in `src/banner.txt` for the full API.

## Developing
Node is for development only (unit tests, build, local server); the shipped files in `dist/` need nothing.

    npm install
    npx playwright install   # one-time, for e2e tests
    npm run serve            # builds, then serves http://localhost:8080/demo/
    npm run test:unit        # pure logic (node:test), no browser
    npm test                 # unit + e2e (Playwright)
    npm run build            # src/ -> dist/

## Layout
- `src/` ES module source. `path-math.js` is pure (no DOM) and unit-testable in Node.
- `src/policy.js` permissions: compiles a policy and decides writes (pure, no DOM, unit-tested in Node).
- `src/tools.js`, `src/tools/` creation tools (a registry like the widgets', one file per tool); `src/menu.js` the context menu UI.
- `src/widgets/` one file per widget family. `transform.js` (scale and rotate/skew layers) and `halo.js` (an invisible fat outline that keeps thin shapes grabbable) are generic; `src/body.js` is the press-to-move / click-to-switch-mode gesture; the rest are per-shape *edit mode* widgets. Registration order matters (see `src/index.js`): the registry returns the first match, so the catch-all fallback is imported last.
- `dist/` built output, committed so the demo works without a build step.
- `demo/` widget demo page, loads `dist/sable-edit.js`.
- `test/unit/`, `test/e2e/`
