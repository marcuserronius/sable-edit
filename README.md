# SableEdit

Drop-in SVG element editor (paths first). No runtime dependencies.

Every selected shape cycles through three edit modes by clicking or tapping its centre **hub**: **scale**, **rotate/skew**, and **edit** (the shape's own controls). Dragging the hub moves the shape.

**Creating shapes:** right-click (Ctrl-click on a Mac) anywhere on the canvas for the context menu. **Use Once** arms a tool for a single shape and then returns to the pointer; **Switch Tool** keeps it until you choose Pointer (or press Esc). Built-in tools: **circle** (press for the centre, drag out to the radius), **rectangle** (press one corner, release on the opposite one), **ellipse** (the same, for its bounding box) and **line** (press the start, release at the end). The menu is the only UI the widget needs, so it works in pages with no toolbar; `ed.tool`, `ed.useTool(id)` and `ed.addMenu(fn)` are there for hosts that want their own.

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
- `src/tools.js`, `src/tools/` creation tools (a registry like the widgets', one file per tool); `src/menu.js` the context menu UI.
- `src/widgets/` one file per widget family. `transform.js` (scale and rotate/skew layers) and `hub.js` (the centre handle) are generic; the rest are per-shape *edit mode* widgets. Registration order matters (see `src/index.js`): the registry returns the first match, so the catch-all fallback is imported last.
- `dist/` built output, committed so the demo works without a build step.
- `demo/` widget demo page, loads `dist/sable-edit.js`.
- `test/unit/`, `test/e2e/`
