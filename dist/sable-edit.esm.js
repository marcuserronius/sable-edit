/*! SableEdit (sable-edit.js) — drop-in SVG element editor (paths first). No dependencies.
  Usage:  const ed = SableEdit.attach(svgElement, { onChange(el,attr){...} });
  Options: root (limit editable subtree), overlay (existing <g> to draw handles in), mode ('scale'|'rotate'|'edit', default 'scale'),
           pick (default true: press an element to select it, click empty space to deselect),
           selector (editable elements, default basic shapes + path + text),
           onSelect(el), onChange(el, attr, src), onCreate(el),
           createIn (element or selector: where new shapes go, default root), shapeAttrs (attributes for new shapes, default a light
           fill + 2px stroke; if you pass `selector`, include something in shapeAttrs that matches it, e.g. {class:'edit'}),
           menu (default true: right-click / Ctrl-click opens the context menu; false leaves the browser's menu alone),
           policy (permissions, see 'Permissions' below; default none = everything allowed), onDenied(el, {attr, cap, reason, src})
  Instance: select(el|null), selected, refresh() (call after you pan/zoom), changed(el, attr),
            set(el, attr, val, src[, {force}]) (undoable write; val null removes the attribute; returns false if the policy refused it,
            force:true skips the policy; a range or bounds clamp may store something other than val, so read it back if it matters),
            setMany(el, {attr: val, ...}[, src, {force}]) (several attributes, checked together and undone together), undo(), redo(), clearHistory(),
            can([el,] capability), canSet([el,] attr) (el defaults to the selected shape; canSet('style:fill') asks about one style
            property), range([el,] attr) ([min, max], null = open end, or null), bounds([el]) ({x,y,width,height} or null),
            snap([el]) ({x,y} grid step or null),
            policy (get/set: swap the whole policy at runtime),
            canUndo/canRedo, mode (get/set), modes (what the selected shape offers), cycleMode(),
            selection (path / polygon / polyline edit mode: {kind:'node'|'segment', items:[indices]} or null), deleteSelection(), clearSelection()
            (path edit mode also has node types: corner / smooth / symmetric; Shift-drag a handle = symmetric, Alt-drag = break the link; an editor can add
            right-click menu items through ctx.menu(f))
            edit mode: double-click / long-press a shape, or ed.edit(); Esc = back to scale, then deselect; ed.mode='edit' still works
            path segments: right-click > Segment type (L / Q / C / A); lines the editor touches are written H / V / L, shortest first
            (Delete / Backspace / Escape do the same while the page has focus, unless keys:false; the 'key' event lets an editor claim them),
            tool (get/set: 'pointer' or a tool id, stays until changed), useTool(id) (same as tool=: 'use once' is switched off, see ONCE in attach.js), tools (what is registered),
            penSegment (get/set what the path pen's next node adds: 'auto' | 'L' | 'Q' | 'C' | 'A'),
            openMenu(x,y), closeMenu(), addMenu(({x,y,target,editor}) => [items]) (returns a remover),
            on('select'|'change'|'history'|'mode'|'tool'|'pen'|'create'|'remove'|'denied', fn), destroy()   (Ctrl/Cmd+Z, +Shift or Ctrl+Y bound unless keys:false)
  Permissions: policy is a list of rules, applied in order; nothing is allowed until a rule grants it, and a shape nothing is granted to
    can't be selected (so {select:'.edit', can:'all'} is the old 'these shapes are editable'). Pass {rules:[...], create:false|[tool ids]}
    to also limit which creation tools the menu offers. A rule is {select, can, cannot, attrs, pin, bounds, ranges, snap}:
      select  CSS selector | (el)=>bool | element | array of those (omitted = every shape)
      can / cannot  capabilities: transform.move|scale|rotate|skew, geometry.edit (the edit mode), nodes.insert|delete (need geometry.edit),
              attrs.edit (every other attribute: fill, stroke, style, class...); 'all' and 'group.*' work. Within a rule cannot wins; a later rule wins.
      attrs   {allow:[globs], deny:[globs]} narrows attrs.edit; 'stroke*' blocks the attribute and style="stroke..." alike
      pin     'endpoints' (first/last node of an open path/polyline; both ends of a line) and/or node indices (negative = from the end);
              a pinned node can't move or be deleted (its bezier handles stay free). Any pin turns the shape's transform.* off, and an index pin
              also turns nodes.insert/delete off. Locked handles are drawn grey; hidden modes and handles are simply not offered.
      bounds  {x,y,width,height} (or [x,y,width,height]) in the shape's parent coordinate system (the space its transform maps into): nodes
              (a path's anchors and bezier handles, a polygon's vertices, a rect's corners, an ellipse's extent) may not leave it. Stroke
              width isn't counted. Where there is one obvious answer the edit is clamped: a dragged node stops at the wall and slides along
              it, a move stops at the wall, a resize keeps the far edges. Scale / rotate / skew that would cross it, and arcs that would bulge
              out, are refused (the pointer just stops). An edit that doesn't make an already out-of-bounds shape worse is allowed. text, g
              and other shapes are measured with getBBox. null clears an earlier rule's bounds. New shapes from the creation tools aren't
              clamped as they're drawn; the first edit afterwards is.
      snap    10 | [10, 5] | {x, y}: a grid step in the shape's own coordinates (the numbers stored in d, points, x, cx...). Whatever an edit
              moves lands on the grid: path anchors and bezier handles, polygon vertices, rect edges, line ends, circle / ellipse centres and the
              edge a radius handle drags. Arc radii and flags aren't snapped. Only coordinates the edit changes are snapped (an off-grid shape
              stays as it is until you touch that part). A move shifts the whole shape by one amount, and a dragged node snaps together with the
              bezier handles that travel with it, so nothing is squashed or bent. Adding or deleting a node doesn't snap. Snapping is forced, not a
              user toggle, and applies to ed.set() too. The order is snap, then pins and capabilities, then ranges, then bounds: a range or a wall
              that is off the grid wins, and a pinned node still can't move (a nudge that snaps back onto it is no move at all). null clears.
      ranges  {attr: [min, max]} (null = open end): numeric attribute values are clamped ('r': [5,50]), and style="stroke-width:..." is limited
              the same way; keys are globs. A value that isn't a number, or removing a ranged attribute, is refused. {} clears.
    Markup: for embeds with no JS config, a policy list may contain the string 'markup' (policy: 'markup' is the short form), which
    reads data-sable-policy="..." attributes from the SVG itself. Where 'markup' sits in the list decides who wins (rules after it
    override the markup, rules before it are overridden by it). An element's declarations are its ancestors' (outermost first, up to the
    attached root) then its own, so one on a <g> covers the group and one on the <svg> is the default for the drawing. Clauses are
    separated by ';':   geometry.edit, nodes.*  (bare words grant; -nodes.delete takes away; can: / cannot: spell it out),
    attrs-allow: fill, stroke*   attrs-deny: style   (globs; empty clears),   pin: endpoints, 0, -1   (empty clears),
    bounds: 0 0 600 400   ('none' clears),   range: r=5..50   (either end may be empty; 'range: none' clears),   snap: 10  or  snap: 10 5   ('none' clears). Example:
      <path id="curve" data-sable-policy="geometry.edit, nodes.*; attrs-deny: stroke*, style; pin: endpoints; bounds: 0 0 600 400" .../>
    Markup is read only when 'markup' is listed: SVG that came from users must not be able to grant itself powers, so enable it only for
    markup the host wrote. The attribute itself can't be written through the editor (ed.set force:true is the host's way). A declaration
    that doesn't parse throws when the editor attaches (or the policy is set); one that goes bad later switches everything off for the shapes
    it covers and says so once in the console. Edits to the attributes count from the next check; an open selection keeps its handles until
    it is reselected. Bounds and pins on an ancestor apply to its descendants unchanged, so put them on groups whose children sit directly in them.
    A refusal reports reason 'capability' | 'attribute' | 'range' | 'pinned' | 'bounds' in 'denied'. Widget authors: ctx.set returns false when
    a write was refused; ctx.batch(fn) makes the writes inside fn one step, so bounds are judged on the finished shape (a rect resize writes
    x, y, width and height, and must not be judged on each half-written state); after a write, read the attribute back if the policy may clamp it.
    Every write goes through the policy (widgets, move/scale/rotate gestures, ed.set), so it holds even for edits that don't come from a handle.
    It guards the user, not the page: script that can reach the DOM can still write attributes. For a real guarantee, run checkWrite() from
    src/policy.js (pure, works in Node) on the server. Mistakes in a policy (unknown capability, rule key typo) throw at attach time.
  Context menu: right-click (Ctrl-click on a Mac) anywhere on the canvas. 'Switch Tool' keeps the tool until you pick Pointer (or press Esc);
    with the pen armed it also has Next segment, Close path and Finish path. Items are {label, action, checked, disabled, submenu:[...]} or {sep:1}.
  Tools:    the pointer tool is the editing behaviour described below; other tools create shapes. Built in: circle (press = centre, drag = radius),
            rect (press = one corner, release = the opposite corner, any direction), ellipse (the same two corners, of its bounding box),
            line (press = start point, release = end point), path (the pen, below).
            A tool is armed -> every press is its gesture (nothing is selected, handles stay out of the way); Esc cancels a drag.
            A created shape is one undo step; the tool stays armed with nothing selected (every tool is sticky: 'use once' is switched off).
            Path pen: the path editor with the pen on, so the selected path keeps its handles. The pen continues from the selected node of the selected
            path if that node is an endpoint (a first node reverses the path), else a press starts a new path. Press = add a node (line), press-drag = pull
            handles (symmetric node, S form; Alt = break), press the other end of the path (2+ nodes) = close, a drag on that press shapes the closing segment. Click the end node again, double-click it, Enter
            or menu > Finish path = done (the path stays selected). Esc = leave the pen, path still selected in scale mode; Esc again = deselect.
            Every node is an undo step; the policy applies to each one (geometry.edit + nodes.insert, snap grid and bounds, a pinned path isn't extended).
            A tool with `pen:true` has no begin(): {id, label, pen:true, tag, blank: attrs of the empty shape, real(el) -> has it a segment yet}.
            SableEdit.tools.register({id, label, cursor, begin(t, p0, ev) -> {move(p,ev), end(p,ev) -> element|null, cancel?()}})
            t = {host, px(n), make(tag, attrs)}; points are in the createIn container's coordinates.
  Widgets:  SableEdit.widgets.register(el=>bool, ctx=>({update(),destroy()}))   (a widget is a shape's *edit mode*)
            ctx = { el, overlay, matrix(), px(n), toLocal(pointerEvent), toParent(pointerEvent), toOverlay(pointerEvent),
                    bbox(), set(attr,val), on(evt,fn),
                    grab(pointerEvent[, {defer}]) }   grab: forward a press your own overlay element caught, so it still moves/cycles the shape
  Handles are drawn in the overlay in the same space as the document, so editing happens in place.
  Selecting: press a shape to select it (and start moving it, if you drag); click empty space to deselect.
  Modes: press the selected shape anywhere in any mode: drag = move, click/tap without dragging = next mode. The handles show the mode.
         A line or unfilled path is grabbed by its stroke (a few pixels of slack). In path/polygon/polyline edit mode the stroke also means
         double-click = add a node, so there the mode switch waits ~300 ms for a possible second click.
    scale        bounding box in the shape's own frame; edge handles resize one axis, corners resize proportionally (opposite side fixed)
    rotate/skew  corners rotate about the centre (Shift = 15 degree steps), edge midpoints skew parallel to their edge
    edit         the shape's own controls (the registered widget). Shapes with only the catch-all widget (text...) skip this mode.
  Scale and rotate/skew work on any element by writing `transform` (compacted to translate/scale/rotate/matrix when a gesture ends).
  Moving rewrites rect/circle/ellipse/line/polygon/polyline/path coordinates directly and falls back to `transform` for the rest.
  Edit widgets: path, rect, circle, ellipse, line, polygon, polyline. Path editing: drag nodes/handles, Shift mirrors a cubic handle,
  double-click path = add node, double-click node = delete.
  Rect: two corner nodes (x1,y1 / x2,y2) and one corner-radius dot, inset from a free corner by (rx,ry); Shift = circular.
  Arcs: the active arc (click its end node or dot) shows its ellipse; the x-axis handle sets rx + rotation,
  the y-axis handle sets ry (Shift = circular); drag the dot across the chord to flip large-arc/sweep.
  The first edit normalizes `d` to absolute M/L/C/Q/A/Z. */

// src/registry.js
var Widgets = {
  list: [],
  register(match, factory, opts) {
    this.list.push({ match, factory, ...opts });
  },
  find(el) {
    return this.list.find((w) => w.match(el));
  }
};

// src/dom.js
var NS = "http://www.w3.org/2000/svg";
var mk = (n, a = {}) => {
  const e = document.createElementNS(NS, n);
  for (const k in a) e.setAttribute(k, a[k]);
  return e;
};

// src/path-math.js
var lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
var dc = (p, t) => p.length === 1 ? p[0] : dc(p.slice(1).map((q, k) => lerp(p[k], q, t)), t);
var split = (p, t) => {
  const L = [], R2 = [];
  let q = p;
  while (q.length) {
    L.push(q[0]);
    R2.unshift(q.at(-1));
    q = q.slice(1).map((v, k) => lerp(q[k], v, t));
  }
  return [L, R2];
};
var NARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
function parsePath(d) {
  const tk = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [], out = [];
  let i = 0, cmd = null, x = 0, y = 0, sx = 0, sy = 0, lc = null, lq = null;
  while (i < tk.length) {
    if (/[a-zA-Z]/.test(tk[i])) cmd = tk[i++];
    const U = cmd && cmd.toUpperCase(), n = NARGS[U];
    if (n === void 0) break;
    const rel = cmd !== U, a = tk.slice(i, i + n).map(Number);
    i += n;
    if (a.length < n || a.some(isNaN)) break;
    const X = (v) => rel ? x + v : v, Y = (v) => rel ? y + v : v;
    let nc = null, nq = null;
    switch (U) {
      case "Z":
        out.push({ t: "Z", pts: [] });
        x = sx;
        y = sy;
        cmd = null;
        break;
      case "M":
        x = X(a[0]);
        y = Y(a[1]);
        sx = x;
        sy = y;
        out.push({ t: "M", pts: [[x, y]] });
        cmd = rel ? "l" : "L";
        break;
      case "L":
        x = X(a[0]);
        y = Y(a[1]);
        out.push({ t: "L", pts: [[x, y]] });
        break;
      case "H":
        x = X(a[0]);
        out.push({ t: "L", pts: [[x, y]], c: "H" });
        break;
      case "V":
        y = Y(a[0]);
        out.push({ t: "L", pts: [[x, y]], c: "V" });
        break;
      case "C": {
        const p = [[X(a[0]), Y(a[1])], [X(a[2]), Y(a[3])], [X(a[4]), Y(a[5])]];
        out.push({ t: "C", pts: p });
        nc = p[1];
        [x, y] = p[2];
        break;
      }
      case "S": {
        const p = [lc ? [2 * x - lc[0], 2 * y - lc[1]] : [x, y], [X(a[0]), Y(a[1])], [X(a[2]), Y(a[3])]];
        out.push({ t: "C", pts: p, sm: 1 });
        nc = p[1];
        [x, y] = p[2];
        break;
      }
      case "Q": {
        const p = [[X(a[0]), Y(a[1])], [X(a[2]), Y(a[3])]];
        out.push({ t: "Q", pts: p });
        nq = p[0];
        [x, y] = p[1];
        break;
      }
      case "T": {
        const c = lq ? [2 * x - lq[0], 2 * y - lq[1]] : [x, y], p = [c, [X(a[0]), Y(a[1])]];
        out.push({ t: "Q", pts: p, sm: 1 });
        nq = c;
        [x, y] = p[1];
        break;
      }
      case "A":
        x = X(a[5]);
        y = Y(a[6]);
        out.push({ t: "A", arc: a.slice(0, 5), pts: [[x, y]] });
        break;
    }
    lc = nc;
    lq = nq;
  }
  return out;
}
function serPath(segs) {
  const info = segInfo(segs), f2 = (n) => +n.toFixed(3), v = (a) => a.map(f2).join(" ");
  return segs.map((s, i) => {
    if (s.t === "Z") return "Z";
    if (s.t === "L" && s.c && info[i].from) {
      const [x0, y0] = info[i].from, [x, y] = s.pts[0];
      if (s.c === "H" && f2(y) === f2(y0)) return "H" + f2(x);
      if (s.c === "V" && f2(x) === f2(x0)) return "V" + f2(y);
    }
    if (s.sm && (s.t === "C" || s.t === "Q")) {
      const e = smoothCtl(segs, i, info);
      if (e && near(e, s.pts[0])) return (s.t === "C" ? "S" : "T") + v(s.pts.slice(1).flat());
    }
    return s.t + (s.arc ? s.arc.join(" ") + " " : "") + v(s.pts.flat());
  }).join(" ");
}
function arcGeom(p, e, rx, ry, deg, fa, fs) {
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (!rx || !ry || p[0] === e[0] && p[1] === e[1]) return null;
  const phi = deg * Math.PI / 180, c = Math.cos(phi), s = Math.sin(phi), dx = (p[0] - e[0]) / 2, dy = (p[1] - e[1]) / 2;
  const x1 = c * dx + s * dy, y1 = -s * dx + c * dy, lam = x1 * x1 / (rx * rx) + y1 * y1 / (ry * ry);
  if (lam > 1) {
    const k = Math.sqrt(lam);
    rx *= k;
    ry *= k;
  }
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let co = den ? Math.sqrt(Math.max(0, (rx * rx * ry * ry - den) / den)) : 0;
  if (!!fa === !!fs) co = -co;
  const cxp = co * rx * y1 / ry, cyp = -co * ry * x1 / rx, cx = c * cxp - s * cyp + (p[0] + e[0]) / 2, cy = s * cxp + c * cyp + (p[1] + e[1]) / 2;
  const ang = (ux2, uy2, vx, vy) => Math.atan2(ux2 * vy - uy2 * vx, ux2 * vx + uy2 * vy);
  const ux = (x1 - cxp) / rx, uy = (y1 - cyp) / ry, th1 = ang(1, 0, ux, uy);
  let dth = ang(ux, uy, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!fs && dth > 0) dth -= 2 * Math.PI;
  else if (fs && dth < 0) dth += 2 * Math.PI;
  return { cx, cy, rx, ry, phi, c, s, th1, dth, pt: (t) => [cx + rx * Math.cos(t) * c - ry * Math.sin(t) * s, cy + rx * Math.cos(t) * s + ry * Math.sin(t) * c] };
}
function arcFit(P, E, arc, kind, p, opts = {}) {
  const gap = opts.gap || 0, r32 = (v) => +v.toFixed(3);
  let [rx, ry, phi, fa, fs] = arc;
  const g0 = arcGeom(P, E, rx, ry, phi, fa, fs);
  if (!g0) return arc;
  if (kind === "flip") {
    const dist2 = (q) => {
      const m = q.pt(q.th1 + q.dth / 2);
      return Math.hypot(m[0] - p[0], m[1] - p[1]);
    };
    let best = [fa, fs], bd = dist2(g0);
    for (const a of [0, 1]) for (const s of [0, 1]) {
      const q = arcGeom(P, E, rx, ry, phi, a, s);
      if (q && dist2(q) < bd - 1e-6) {
        bd = dist2(q);
        best = [a, s];
      }
    }
    return [rx, ry, phi, best[0], best[1]];
  }
  rx = g0.rx;
  ry = g0.ry;
  if (kind === "rot") {
    for (let n = 0; n < 12; n++) {
      const q = arcGeom(P, E, rx, ry, phi, fa, fs);
      if (!q) break;
      phi = Math.atan2(p[1] - q.cy, p[0] - q.cx) * 180 / Math.PI + 180;
    }
    if (opts.shift) phi = Math.round(phi / 15) * 15;
  } else {
    const X = kind === "rx", t0 = X ? rx : ry, sh = opts.shift;
    const c = g0.c, s_ = g0.s, hx = (P[0] - E[0]) / 2, hy = (P[1] - E[1]) / 2, x1 = c * hx + s_ * hy, y1 = -s_ * hx + c * hy;
    const lo = sh ? Math.hypot(x1, y1) : (() => {
      const [a, o, oth] = X ? [x1, y1, ry] : [y1, x1, rx], k = 1 - (o / oth) ** 2;
      return k > 1e-12 ? Math.abs(a) / Math.sqrt(k) : 0;
    })();
    const tmin = Math.max(Math.ceil(lo * 1e3) / 1e3, 0.1);
    const res = (t) => {
      const q = arcGeom(P, E, X || sh ? t : rx, !X || sh ? t : ry, phi, fa, fs);
      if (!q) return NaN;
      const dx = p[0] - q.cx, dy = p[1] - q.cy;
      return X ? dx * q.c + dy * q.s - gap - q.rx : -dx * q.s + dy * q.c - gap - q.ry;
    };
    let v = tmin;
    if (res(tmin) > 0) {
      const hi = 50 * (Math.hypot(E[0] - P[0], E[1] - P[1]) + t0 + tmin), N = 160, k = Math.pow(hi / tmin, 1 / N);
      let best = null, prev = { t: tmin, f: res(tmin) };
      for (let n = 1, t = tmin * k; n <= N; n++, t *= k) {
        const f2 = res(t);
        if (isNaN(f2)) continue;
        if (prev.f < 0 !== f2 < 0) {
          let a = prev.t, b = t, fa_ = prev.f;
          for (let m = 0; m < 40; m++) {
            const mid2 = (a + b) / 2, fm = res(mid2);
            if (fm < 0 === fa_ < 0) {
              a = mid2;
              fa_ = fm;
            } else b = mid2;
          }
          const r = (a + b) / 2;
          if (best === null || Math.abs(r - t0) < Math.abs(best - t0)) best = r;
        }
        prev = { t, f: f2 };
      }
      v = best ?? hi;
    }
    if (X || sh) rx = v;
    if (!X || sh) ry = v;
  }
  phi = ((phi + 180) % 360 + 360) % 360 - 180;
  return [r32(rx), r32(ry), r32(phi), fa, fs];
}
var same = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
var clone = (s) => ({ ...s, pts: s.pts.map((p) => [...p]), ...s.arc ? { arc: [...s.arc] } : {} });
function segInfo(segs) {
  const out = [];
  let cur = null, sx = null;
  for (const s of segs) {
    if (s.t === "M") {
      cur = sx = s.pts[0];
      out.push({ from: cur, to: cur });
      continue;
    }
    const to = s.t === "Z" ? sx : s.pts.at(-1);
    out.push({ from: cur, to });
    cur = to;
  }
  return out;
}
function segD(segs, i) {
  const s = segs[i], f2 = segInfo(segs)[i];
  if (!s || s.t === "M" || !f2.from) return "";
  const v = (a) => a.map((n) => +n.toFixed(3)).join(" ");
  return "M" + v(f2.from) + (s.t === "Z" ? " L" + v(f2.to) : " " + s.t + (s.arc ? v(s.arc) + " " : "") + v(s.pts.flat()));
}
function nearestSeg(segs, p, opts = {}) {
  const info = segInfo(segs);
  let best = null;
  segs.forEach((s, i) => {
    if (s.t === "M") return;
    const { from, to } = info[i];
    if (!from || (s.t === "Z" || s.t === "L") && same(from, to)) return;
    let at, cp2 = null;
    if (s.t === "A") {
      if (opts.arcs === false) return;
      const g = arcGeom(from, to, ...s.arc);
      at = g ? (t) => g.pt(g.th1 + g.dth * t) : (t) => lerp(from, to, t);
    } else {
      cp2 = s.t === "Z" || s.t === "L" ? [from, to] : [from, ...s.pts];
      at = (t) => dc(cp2, t);
    }
    for (let k = 1; k < 32; k++) {
      const q = at(k / 32), d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (!best || d < best.d) best = { d, i, t: k / 32, cp: cp2 };
    }
  });
  return best;
}
var tidy = (a) => {
  const r = [];
  let skipZ = false;
  a.forEach((s, k) => {
    const n = a[k + 1];
    if (s.t === "M" && (!n || n.t === "M" || n.t === "Z")) {
      skipZ = true;
      return;
    }
    if (s.t === "Z" && (skipZ || !r.length || r.at(-1).t === "Z")) return;
    skipZ = false;
    r.push(s);
  });
  return r;
};
function deleteNodes(segs, idxs, pinned = /* @__PURE__ */ new Set()) {
  const out = segs.map(clone), del = [...idxs].filter((i) => out[i] && out[i].t !== "Z" && !pinned.has(i)).sort((a, b) => b - a);
  if (!del.length || out.filter((s) => s.t !== "Z").length - del.length < 2) return null;
  for (const i of del) {
    if (out[i].t === "M") {
      const n = out[i + 1];
      if (n && n.t !== "Z" && n.t !== "M") {
        n.t = "M";
        n.pts = [n.pts.at(-1)];
        delete n.arc;
      }
    }
    out.splice(i, 1);
    if (out[i] && out[i].t === "L") out[i].dirty = 1;
  }
  return tidy(out);
}
function deleteSegments(segs, idxs) {
  const want = new Set(idxs), info = segInfo(segs), out = [];
  let did = false, i = 0;
  while (i < segs.length) {
    if (segs[i].t !== "M") {
      out.push(clone(segs[i]));
      i++;
      continue;
    }
    let j = i + 1;
    while (j < segs.length && segs[j].t !== "M") j++;
    const z = segs.findIndex((s, k) => k > i && k < j && s.t === "Z"), keep = () => {
      for (let k = i; k < j; k++) out.push(clone(segs[k]));
    };
    if (z >= 0 && z !== j - 1) {
      keep();
      i = j;
      continue;
    }
    const E = [];
    for (let k = i + 1; k < j; k++) if (segs[k].t !== "Z") E.push({ idx: k, seg: clone(segs[k]), from: info[k].from });
    if (z >= 0 && !same(info[z].from, info[z].to)) E.push({ idx: z, seg: { t: "L", pts: [[...info[z].to]], dirty: 1 }, from: info[z].from });
    const first = E.findIndex((e) => want.has(e.idx));
    if (first < 0) {
      keep();
      i = j;
      continue;
    }
    did = true;
    const ring = z >= 0 ? [...E.slice(first + 1), ...E.slice(0, first + 1)] : E;
    let run = null;
    for (const e of ring) {
      if (want.has(e.idx)) {
        run = null;
        continue;
      }
      if (!run) {
        out.push({ t: "M", pts: [[...e.from]] });
        run = 1;
      }
      out.push(e.seg);
    }
    i = j;
  }
  const r = tidy(out);
  return did && r.length ? r : null;
}
function deletePoints(pts, idxs, min, pinned = /* @__PURE__ */ new Set()) {
  const rm = new Set([...idxs].filter((i) => i >= 0 && i < pts.length && !pinned.has(i)));
  return rm.size && pts.length - rm.size >= min ? pts.filter((_, i) => !rm.has(i)) : null;
}
var near = (a, b) => Math.abs(a[0] - b[0]) <= 0.01 && Math.abs(a[1] - b[1]) <= 0.01;
var refl = (h, n) => [2 * n[0] - h[0], 2 * n[1] - h[1]];
var vec = (a, b) => [a[0] - b[0], a[1] - b[1]];
var vlen = (v) => Math.hypot(v[0], v[1]);
function smoothCtl(segs, i, info) {
  const s = segs[i], p = segs[i - 1];
  if (s.t === "C") return p && p.t === "C" ? refl(p.pts[1], info[i - 1].to) : info[i].from;
  if (s.t === "Q") return p && p.t === "Q" ? refl(p.pts[0], info[i - 1].to) : info[i].from;
  return null;
}
function healSmooth(segs) {
  const info = segInfo(segs);
  segs.forEach((s, i) => {
    if (!s.sm) return;
    const e = (s.t === "C" || s.t === "Q") && smoothCtl(segs, i, info);
    if (!e || !near(e, s.pts[0])) delete s.sm;
  });
  return segs;
}
function fixSmooth(segs) {
  const info = segInfo(segs);
  segs.forEach((s, i) => {
    if (!s.sm) return;
    const e = smoothCtl(segs, i, info);
    if (e && (s.t === "C" || s.t === "Q")) s.pts[0] = e;
    else delete s.sm;
  });
  return segs;
}
function nodeHandles(segs, j, info = segInfo(segs)) {
  const s = segs[j];
  if (!s || s.t === "Z") return null;
  let m = j;
  while (m > 0 && segs[m].t !== "M") m--;
  let z = -1, e = -1;
  for (let k = m + 1; k < segs.length && segs[k].t !== "M"; k++) {
    if (segs[k].t === "Z") {
      z = k;
      break;
    }
    e = k;
  }
  const wrap = z >= 0 && e > m && near(info[e].to, info[m].to);
  const endH = (i) => {
    const q = segs[i];
    return q && q.t === "C" ? { i, k: 1 } : q && q.t === "Q" ? { i, k: 0 } : null;
  };
  const startH = (i) => {
    const q = segs[i];
    return q && (q.t === "C" || q.t === "Q") ? { i, k: 0 } : null;
  };
  const a = s.t === "M" ? wrap ? endH(e) : null : endH(j);
  const b = wrap && j === e ? startH(m + 1) : startH(j + 1);
  return { n: info[j].to, a, b, flag: b && b.i === j + 1 ? b.i : -1 };
}
function nodeType(segs, j, info = segInfo(segs)) {
  const h = nodeHandles(segs, j, info);
  if (!h || !h.a || !h.b) return null;
  if (h.flag >= 0 && segs[h.flag].sm) return "symmetric";
  const A2 = vec(segs[h.a.i].pts[h.a.k], h.n), B = vec(segs[h.b.i].pts[h.b.k], h.n), la = vlen(A2), lb = vlen(B);
  if (la < 5e-3 || lb < 5e-3) return "corner";
  if (Math.abs(A2[0] * B[1] - A2[1] * B[0]) / (la * lb) > 5e-3 || A2[0] * B[0] + A2[1] * B[1] >= 0) return "corner";
  return Math.abs(la - lb) <= Math.max(5e-3, 1e-3 * Math.max(la, lb)) ? "symmetric" : "smooth";
}
function handleLinks(segs, i, k) {
  const info = segInfo(segs), s = segs[i];
  if (!s || s.t !== "C" && s.t !== "Q") return [];
  let m = i - 1;
  while (m >= 0 && segs[m].t === "Z") m--;
  const nodes = s.t === "Q" ? [m, i] : k === 0 ? [m] : [i], out = [];
  for (const j of nodes) {
    const h = j >= 0 && nodeHandles(segs, j, info);
    if (!h || !h.a || !h.b) continue;
    const mine = h.a.i === i && h.a.k === k ? "a" : h.b.i === i && h.b.k === k ? "b" : null;
    if (!mine) continue;
    const part = mine === "a" ? h.b : h.a;
    out.push({ node: h.n, partner: part, type: nodeType(segs, j, info), len: vlen(vec(segs[part.i].pts[part.k], h.n)), flag: h.flag });
  }
  return out;
}
function dragHandle(segs, i, k, p, links, force) {
  segs[i].pts[k] = p;
  for (const L of links) {
    const mode = force === "free" ? "corner" : force === "sym" ? "symmetric" : L.type, q = segs[L.partner.i];
    if (mode === "symmetric") q.pts[L.partner.k] = refl(p, L.node);
    else if (mode === "smooth") {
      const v = vec(L.node, p), d = vlen(v);
      if (d > 1e-6) q.pts[L.partner.k] = [L.node[0] + v[0] / d * L.len, L.node[1] + v[1] / d * L.len];
    }
    if (L.flag >= 0) {
      if (force === "free") delete segs[L.flag].sm;
      else if (force === "sym" && segs[L.flag].t === segs[L.flag - 1]?.t) segs[L.flag].sm = 1;
    }
  }
}
function setNodeType(segs, j, type) {
  const h = nodeHandles(segs, j);
  if (!h || !h.a || !h.b) return null;
  const out = segs.map(clone), A2 = out[h.a.i].pts[h.a.k], B = out[h.b.i], la = vlen(vec(A2, h.n)), lb = vlen(vec(B.pts[h.b.k], h.n));
  if (type === "corner") {
    if (h.flag >= 0) delete out[h.flag].sm;
  } else if (type === "smooth") {
    if (la < 5e-3) return null;
    const L = lb < 5e-3 ? la : lb;
    B.pts[h.b.k] = [h.n[0] - (A2[0] - h.n[0]) / la * L, h.n[1] - (A2[1] - h.n[1]) / la * L];
  } else if (type === "symmetric") {
    B.pts[h.b.k] = refl(A2, h.n);
    if (h.flag >= 0 && out[h.flag].t === out[h.flag - 1]?.t) out[h.flag].sm = 1;
  } else return null;
  return healSmooth(out);
}
function retype(segs) {
  const info = segInfo(segs), f2 = (n) => +n.toFixed(3);
  segs.forEach((s, i) => {
    if (!s.dirty) return;
    delete s.dirty;
    if (s.t !== "L") {
      delete s.c;
      return;
    }
    const [x0, y0] = info[i].from || [NaN, NaN], [x, y] = s.pts[0];
    if (f2(y) === f2(y0) && f2(x) !== f2(x0)) s.c = "H";
    else if (f2(x) === f2(x0) && f2(y) !== f2(y0)) s.c = "V";
    else delete s.c;
  });
  return segs;
}
var lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
var unit = (v) => {
  const d = Math.hypot(v[0], v[1]);
  return d > 1e-9 ? [v[0] / d, v[1] / d] : null;
};
function endTangent(segs, i, info) {
  const q = segs[i];
  if (!q || q.t === "M" || q.t === "Z") return null;
  const { from, to } = info[i];
  if (q.t === "C") return unit(vec(q.pts[2], q.pts[1])) || unit(vec(q.pts[2], q.pts[0])) || unit(vec(to, from));
  if (q.t === "Q") return unit(vec(q.pts[1], q.pts[0])) || unit(vec(to, from));
  if (q.t === "A") {
    const g = arcGeom(from, to, ...q.arc);
    if (!g) return unit(vec(to, from));
    const t = g.th1 + g.dth, sg = Math.sign(g.dth) || 1, sn = Math.sin(t), cs = Math.cos(t);
    return unit([sg * (-g.rx * sn * g.c - g.ry * cs * g.s), sg * (-g.rx * sn * g.s + g.ry * cs * g.c)]);
  }
  return unit(vec(to, from));
}
function arcThrough(from, mid2, to) {
  const [ax, ay] = from, [bx, by] = mid2, [cx, cy] = to, d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  const sc = Math.hypot(cx - ax, cy - ay);
  if (Math.abs(d) < 1e-6 * sc * sc) return null;
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy, ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d, uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d, R2 = Math.hypot(ax - ux, ay - uy);
  const m = vec(mid2, from), n = vec(to, mid2);
  return [R2, R2, 0, vec(from, mid2)[0] * vec(to, mid2)[0] + vec(from, mid2)[1] * vec(to, mid2)[1] > 0 ? 1 : 0, m[0] * n[1] - m[1] * n[0] > 0 ? 1 : 0];
}
function arcTangent(from, to, d) {
  const ch = vec(to, from), cr = d[0] * ch[1] - d[1] * ch[0], L2 = ch[0] * ch[0] + ch[1] * ch[1];
  if (Math.abs(cr) < 1e-6 * Math.sqrt(L2)) return null;
  const R2 = L2 / (2 * Math.abs(cr));
  return [R2, R2, 0, d[0] * ch[0] + d[1] * ch[1] < 0 ? 1 : 0, cr > 0 ? 1 : 0];
}
function arcPieces(g, to, quad) {
  const n = Math.max(1, Math.ceil(Math.abs(g.dth) / (quad ? Math.PI / 4 : Math.PI / 2) - 1e-9)), st = g.dth / n, out = [];
  const d = (t) => [-g.rx * Math.sin(t) * g.c - g.ry * Math.cos(t) * g.s, -g.rx * Math.sin(t) * g.s + g.ry * Math.cos(t) * g.c];
  for (let j = 0; j < n; j++) {
    const t1 = g.th1 + j * st, t2 = t1 + st, P2 = j === n - 1 ? to : g.pt(t2);
    if (quad) {
      const m = g.pt(t1 + st / 2), k = 1 / Math.cos(st / 2);
      out.push({ t: "Q", pts: [[g.cx + (m[0] - g.cx) * k, g.cy + (m[1] - g.cy) * k], P2] });
    } else {
      const k = 4 / 3 * Math.tan(st / 4), P1 = g.pt(t1), D1 = d(t1), D2 = d(t2);
      out.push({ t: "C", pts: [[P1[0] + k * D1[0], P1[1] + k * D1[1]], [P2[0] - k * D2[0], P2[1] - k * D2[1]], P2] });
    }
  }
  return out;
}
function convertSegment(segs, i, type, info = segInfo(segs)) {
  const s = segs[i];
  if (!s || s.t === "M" || s.t === "Z" || s.t === type) return null;
  const { from, to } = info[i], g = s.t === "A" ? arcGeom(from, to, ...s.arc) : null, cp2 = s.t === "C" || s.t === "Q" ? [from, ...s.pts] : null;
  if (type === "L") return [{ t: "L", pts: [[...to]] }];
  if (type === "Q") {
    if (s.t === "L" || s.t === "A" && !g) return [{ t: "Q", pts: [lerp2(from, to, 0.5), [...to]] }];
    if (s.t === "C") {
      const [a, b] = s.pts;
      return [{ t: "Q", pts: [[(3 * (a[0] + b[0]) - from[0] - to[0]) / 4, (3 * (a[1] + b[1]) - from[1] - to[1]) / 4], [...to]] }];
    }
    return arcPieces(g, to, true);
  }
  if (type === "C") {
    if (s.t === "L" || s.t === "A" && !g) return [{ t: "C", pts: [lerp2(from, to, 1 / 3), lerp2(from, to, 2 / 3), [...to]] }];
    if (s.t === "Q") {
      const c = s.pts[0];
      return [{ t: "C", pts: [lerp2(from, c, 2 / 3), lerp2(to, c, 2 / 3), [...to]] }];
    }
    return arcPieces(g, to, false);
  }
  if (type === "A") {
    let a = cp2 && arcThrough(from, dc(cp2, 0.5), to);
    if (!a) {
      const d = i > 0 && endTangent(segs, i - 1, info);
      a = d && arcTangent(from, to, d);
    }
    if (!a) {
      const R2 = Math.hypot(to[0] - from[0], to[1] - from[1]) / (2 * Math.sin(0.5));
      a = [R2, R2, 0, 0, 1];
    }
    return [{ t: "A", arc: a.map((n) => +n.toFixed(3)), pts: [[...to]] }];
  }
  return null;
}
function convertSegments(segs, idxs, type) {
  const info = segInfo(segs), want = new Set(idxs), out = [], sel = [];
  let did = false;
  segs.forEach((s, i) => {
    const r = want.has(i) ? convertSegment(segs, i, type, info) : null;
    if (want.has(i) && s.t !== "M") sel.push(...r ? r.map((_, k) => out.length + k) : [out.length]);
    if (r) {
      did = true;
      r.forEach((q) => out.push({ ...q, dirty: 1 }));
    } else out.push(clone(s));
  });
  return did ? { segs: healSmooth(out), sel } : null;
}

// src/util.js
var num = (el, a) => parseFloat(el.getAttribute(a)) || 0;
var rnd = (v) => +v.toFixed(3);
var box4 = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

// src/policy.js
var CAPS = ["transform.move", "transform.scale", "transform.rotate", "transform.skew", "geometry.edit", "nodes.insert", "nodes.delete", "attrs.edit"];
var XF = CAPS.filter((c) => c.startsWith("transform."));
var GEO = { path: ["d"], polygon: ["points"], polyline: ["points"], line: ["x1", "y1", "x2", "y2"], rect: ["x", "y", "width", "height", "rx", "ry"], circle: ["cx", "cy", "r"], ellipse: ["cx", "cy", "rx", "ry"] };
var NODE_ATTRS = { path: ["d"], polygon: ["points"], polyline: ["points"], line: ["x1", "y1", "x2", "y2"] };
var MODE_CAPS = { scale: ["transform.scale"], rotate: ["transform.rotate", "transform.skew"], edit: ["geometry.edit"] };
var TOL = 1e-3;
var expand = (list) => {
  const out = /* @__PURE__ */ new Set();
  for (const t of [].concat(list ?? [])) {
    const m = t === "all" || t === "*" ? CAPS : CAPS.filter((c) => t.endsWith(".*") ? c.startsWith(t.slice(0, -1)) : c === t);
    if (!m.length) throw new Error(`SableEdit policy: unknown capability "${t}"`);
    m.forEach((c) => out.add(c));
  }
  return out;
};
var glob = (g) => new RegExp("^" + String(g).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
var globs = (l) => l == null ? null : [].concat(l).map(glob);
var matcher = (s) => typeof s === "string" ? (el) => el.matches(s) : typeof s === "function" ? s : Array.isArray(s) ? /* @__PURE__ */ ((m) => (el) => m.some((f2) => f2(el)))(s.map(matcher)) : (el) => el === s;
var normPin = (p) => [].concat(p ?? []).map((t) => {
  if (t === "endpoints" || Number.isInteger(t)) return t;
  throw new Error(`SableEdit policy: bad pin "${t}" (use 'endpoints' or a node index)`);
});
var normBounds = (b) => {
  if (b == null || b === false) return null;
  const [x, y, w, h] = Array.isArray(b) ? b : [b.x, b.y, b.width, b.height];
  if (![x, y, w, h].every(Number.isFinite) || w < 0 || h < 0) throw new Error("SableEdit policy: bounds needs {x, y, width, height} (numbers, width and height >= 0)");
  return [x, y, x + w, y + h];
};
var normRanges = (r) => {
  if (r == null) return [];
  return Object.entries(r).map(([k, v]) => {
    const [a, b] = [].concat(v), min = a == null ? -Infinity : a, max = b == null ? Infinity : b;
    if (!(min <= max) || ![min, max].every((x) => typeof x === "number" && !Number.isNaN(x))) throw new Error(`SableEdit policy: bad range for "${k}" (use [min, max], either may be null)`);
    return { re: glob(k), min, max };
  });
};
var MARKUP_ATTR = "data-sable-policy";
var normSnap = (s) => {
  if (s == null || s === false) return null;
  const [x, y] = Array.isArray(s) ? [s[0], s[1] ?? s[0]] : typeof s === "object" ? [s.x ?? s.y, s.y ?? s.x] : [s, s];
  if (![x, y].every((v) => typeof v === "number" && Number.isFinite(v) && v > 0)) throw new Error("SableEdit policy: snap needs a positive number, [x, y] or {x, y}");
  return [x, y];
};
var only = (o, keys, what) => {
  for (const k in o) if (!keys.includes(k)) throw new Error(`SableEdit policy: unknown ${what} key "${k}"`);
};
var NUM = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;
var polyNodes = (pts, closed) => ({ pts, ends: closed || !pts.length ? [] : pts.length > 1 ? [0, pts.length - 1] : [0] });
function pathNodes(segs) {
  const pts = [], seg = [], ends = [];
  let from = -1, closed = false;
  const flush = () => {
    if (from >= 0 && !closed && pts.length > from) {
      ends.push(from);
      if (pts.length - 1 > from) ends.push(pts.length - 1);
    }
  };
  segs.forEach((s, i) => {
    if (s.t === "M") {
      flush();
      from = pts.length;
      closed = false;
    }
    if (s.t === "Z") {
      closed = true;
      return;
    }
    pts.push(s.pts.at(-1));
    seg.push(i);
  });
  flush();
  return { pts, ends, seg };
}
var readNodes = (tag, get) => {
  if (tag === "path") return pathNodes(parsePath(get("d") || ""));
  if (tag === "polygon" || tag === "polyline") {
    const n = (get("points") || "").match(NUM) || [], p = [];
    for (let i = 0; i + 1 < n.length; i += 2) p.push([+n[i], +n[i + 1]]);
    return polyNodes(p, tag === "polygon");
  }
  if (tag === "line") {
    const g = (a) => parseFloat(get(a)) || 0;
    return polyNodes([[g("x1"), g("y1")], [g("x2"), g("y2")]], false);
  }
  return null;
};
function pinnedIdx(n, pin) {
  const s = /* @__PURE__ */ new Set();
  for (const t of pin) {
    if (t === "endpoints") n.ends.forEach((i) => s.add(i));
    else {
      const i = t < 0 ? n.pts.length + t : t;
      if (i >= 0 && i < n.pts.length) s.add(i);
    }
  }
  return [...s].sort((a, b) => a - b);
}
var pinsHold = (a, b, pin) => {
  const at = (n) => pinnedIdx(n, pin).map((i) => n.pts[i]), x = at(a), y = at(b);
  return x.length === y.length && x.every((p, i) => Math.abs(p[0] - y[i][0]) <= TOL && Math.abs(p[1] - y[i][1]) <= TOL);
};
var cssProps = (s) => {
  const o = {}, parts = [];
  let d = 0, q = "", cur = "";
  for (const ch of s || "") {
    if (q) {
      if (ch === q) q = "";
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      q = ch;
      cur += ch;
      continue;
    }
    if (ch === "(") d++;
    else if (ch === ")") d = Math.max(0, d - 1);
    if (ch === ";" && !d) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  for (const p of parts) {
    const i = p.indexOf(":");
    if (i < 0) continue;
    const k = p.slice(0, i).trim().toLowerCase();
    if (k) o[k] = p.slice(i + 1).trim();
  }
  return o;
};
function finish(tag, can, allow, deny, pin, bounds, ranges, snap) {
  pin = NODE_ATTRS[tag] ? pin : [];
  if (pin.length) {
    XF.forEach((c) => can.delete(c));
    if (pin.some((t) => typeof t === "number")) {
      can.delete("nodes.insert");
      can.delete("nodes.delete");
    }
  }
  if (!can.has("geometry.edit")) {
    can.delete("nodes.insert");
    can.delete("nodes.delete");
  }
  const denied = (n) => !!deny && deny.some((r) => r.test(n));
  const rangesFor = (n) => ranges.filter((r) => r.re.test(n));
  return {
    tag,
    pin,
    bounds,
    snap,
    caps: can,
    can: (c) => can.has(c),
    denied,
    propOk: (n) => !denied(n) && (!allow || allow.some((r) => r.test(n))),
    selectable: can.size > 0,
    rangesFor,
    /* [min, max] (null = open end) that applies to an attribute, or null: for host UIs that size their own sliders */
    range: (n) => {
      const rs = rangesFor(n);
      if (!rs.length) return null;
      const lo = Math.max(...rs.map((r) => r.min)), hi = Math.min(...rs.map((r) => r.max));
      return [lo === -Infinity ? null : lo, hi === Infinity ? null : hi];
    }
  };
}
var OPEN = { tag: "", pin: [], bounds: null, snap: null, caps: new Set(CAPS), can: () => true, denied: () => false, propOk: () => true, selectable: true, rangesFor: () => [], range: () => null };
var MARKUP = Symbol("markup");
var compileRule = (r) => {
  if (!r || typeof r !== "object" || Array.isArray(r)) throw new Error('SableEdit policy: a rule is an object (or the string "markup")');
  only(r, ["select", "can", "cannot", "attrs", "pin", "bounds", "ranges", "snap"], "rule");
  if (r.attrs) only(r.attrs, ["allow", "deny"], "attrs");
  return {
    match: r.select == null ? () => true : matcher(r.select),
    can: r.can === void 0 ? null : expand(r.can),
    cannot: r.cannot === void 0 ? null : expand(r.cannot),
    attrs: r.attrs ? { ..."allow" in r.attrs && { allow: globs(r.attrs.allow) }, ..."deny" in r.attrs && { deny: globs(r.attrs.deny) } } : null,
    pin: r.pin === void 0 ? null : normPin(r.pin),
    bounds: r.bounds === void 0 ? void 0 : normBounds(r.bounds),
    ranges: r.ranges === void 0 ? void 0 : normRanges(r.ranges),
    snap: r.snap === void 0 ? void 0 : normSnap(r.snap)
  };
};
function parseMarkup(str) {
  const r = {}, can = [], cannot = [];
  let ranges = null;
  const list = (v) => v.split(/[\s,]+/).filter(Boolean);
  for (const raw of String(str ?? "").split(";")) {
    const c = raw.trim();
    if (!c) continue;
    const i = c.indexOf(":");
    if (i < 0) {
      for (const t of list(c)) t.startsWith("-") ? cannot.push(t.slice(1)) : can.push(t);
      continue;
    }
    const key = c.slice(0, i).trim().toLowerCase(), v = c.slice(i + 1).trim();
    switch (key) {
      case "can":
        can.push(...list(v));
        break;
      case "cannot":
        cannot.push(...list(v));
        break;
      case "attrs-allow":
      case "attrs-deny": {
        const l = list(v);
        (r.attrs ??= {})[key.slice(6)] = l.length ? l : null;
        break;
      }
      case "pin":
        r.pin = list(v).map((t) => /^[-+]?\d+$/.test(t) ? +t : t);
        break;
      case "bounds": {
        if (!v || v === "none") {
          r.bounds = null;
          break;
        }
        const n = list(v).map(Number);
        if (n.length !== 4) throw new Error("SableEdit policy: bounds needs four numbers: x y width height");
        r.bounds = n;
        break;
      }
      case "snap": {
        if (!v || v === "none") {
          r.snap = null;
          break;
        }
        const n = list(v).map(Number);
        if (n.length > 2) throw new Error("SableEdit policy: snap wants one number or two (x y)");
        r.snap = n.length === 1 ? n[0] : n;
        break;
      }
      case "range": {
        ranges ??= {};
        if (v === "none") {
          ranges = {};
          break;
        }
        const m = /^(\S+?)\s*=\s*(\S*)$/.exec(v), e = m && m[2].split("..");
        if (!m || e.length !== 2) throw new Error(`SableEdit policy: range wants name=min..max (either end may be empty), got "${v}"`);
        ranges[m[1]] = e.map((x) => x === "" ? null : Number(x));
        break;
      }
      default:
        throw new Error(`SableEdit policy: unknown clause "${key}" in data-sable-policy`);
    }
  }
  if (can.length) r.can = can;
  if (cannot.length) r.cannot = cannot;
  if (ranges) r.ranges = ranges;
  return r;
}
function compilePolicy(spec, env = {}) {
  if (spec == null) return null;
  const str = typeof spec === "string", arr = Array.isArray(spec), rules = str ? [spec] : arr ? spec : spec.rules || [], create = str || arr ? true : spec.create ?? true;
  if (!str && !arr) only(spec, ["rules", "create"], "policy");
  const R2 = rules.map((r) => r === "markup" ? MARKUP : compileRule(r));
  const hasMarkup = R2.includes(MARKUP), cache = /* @__PURE__ */ new Map();
  const fromMarkup = (v) => {
    let c = cache.get(v);
    if (!c) {
      try {
        c = compileRule(parseMarkup(v));
      } catch (e) {
        if (typeof console !== "undefined") console.error(e.message + ` (data-sable-policy="${v}"): everything is switched off for the shapes it covers`);
        c = compileRule({ cannot: "all" });
      }
      cache.set(v, c);
    }
    return c;
  };
  const chain = (el) => {
    const out = [];
    for (let n = el; n && typeof n.getAttribute === "function"; n = n.parentNode) {
      const v = n.getAttribute(MARKUP_ATTR);
      if (v != null) out.unshift(fromMarkup(v));
      if (n === env.root) break;
    }
    return out;
  };
  return {
    spec,
    create,
    /* create: true | false | [tool ids]: which creation tools the menu offers */
    toolOk: (id) => create === true || Array.isArray(create) && create.includes(id),
    /* throws if any data-sable-policy under `root` doesn't parse (a typo shows up when the editor attaches, not as a silent hole) */
    validate(root) {
      if (!hasMarkup || !root) return;
      const els = [root, ...root.querySelectorAll ? root.querySelectorAll("[" + MARKUP_ATTR + "]") : []];
      for (const e of els) {
        const v = e.getAttribute && e.getAttribute(MARKUP_ATTR);
        if (v == null) continue;
        try {
          compileRule(parseMarkup(v));
        } catch (err) {
          throw new Error(`${err.message} (in data-sable-policy="${v}" on <${e.tagName}${e.id ? ' id="' + e.id + '"' : ""}>)`);
        }
      }
    },
    resolve(el) {
      const can = /* @__PURE__ */ new Set();
      let allow = null, deny = null, pin = [], bounds = null, ranges = [], snap = null;
      const apply = (r) => {
        r.can && r.can.forEach((c) => can.add(c));
        r.cannot && r.cannot.forEach((c) => can.delete(c));
        if (r.attrs) {
          if ("allow" in r.attrs) allow = r.attrs.allow;
          if ("deny" in r.attrs) deny = r.attrs.deny;
        }
        if (r.pin) pin = r.pin;
        if (r.bounds !== void 0) bounds = r.bounds;
        if (r.ranges !== void 0) ranges = r.ranges;
        if (r.snap !== void 0) snap = r.snap;
      };
      for (const r of R2) {
        if (r === MARKUP) chain(el).forEach(apply);
        else if (r.match(el)) apply(r);
      }
      return finish(el.tagName, can, allow, deny, pin, bounds, ranges, snap);
    }
  };
}
var modeOk = (p, m) => MODE_CAPS[m].some((c) => p.can(c));
function attrOk(p, attr, old, nw) {
  if (attr !== "style") return p.propOk(attr);
  if (p.denied("style")) return false;
  const a = cssProps(old), b = cssProps(nw);
  return [.../* @__PURE__ */ new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).every(p.propOk);
}
var NUM1 = /^\s*([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)\s*(.*?)\s*$/;
var clampNum = (rs, v) => rs.reduce((x, r) => Math.min(r.max, Math.max(r.min, x)), v);
function rangeValue(p, attr, old, nw) {
  if (attr === "style") {
    const a = cssProps(old), b = cssProps(nw);
    let hit = false;
    if (Object.keys(a).some((k) => !(k in b) && p.rangesFor(k).length)) return void 0;
    for (const k of Object.keys(b)) {
      const rs2 = p.rangesFor(k);
      if (!rs2.length || a[k] === b[k]) continue;
      const m2 = NUM1.exec(b[k]);
      if (!m2) return void 0;
      const v2 = clampNum(rs2, +m2[1]);
      if (v2 !== +m2[1]) {
        b[k] = rnd(v2) + m2[2];
        hit = true;
      }
    }
    return hit ? Object.entries(b).map(([k, v2]) => k + ":" + v2).join("; ") : nw;
  }
  const rs = p.rangesFor(attr);
  if (!rs.length) return nw;
  if (nw == null) return void 0;
  const m = NUM1.exec(nw);
  if (!m) return void 0;
  const v = clampNum(rs, +m[1]);
  return v === +m[1] ? nw : rnd(v) + m[2];
}
var mul = (A2, B) => [A2[0] * B[0] + A2[2] * B[1], A2[1] * B[0] + A2[3] * B[1], A2[0] * B[2] + A2[2] * B[3], A2[1] * B[2] + A2[3] * B[3], A2[0] * B[4] + A2[2] * B[5] + A2[4], A2[1] * B[4] + A2[3] * B[5] + A2[5]];
var ap = (M, q) => [M[0] * q[0] + M[2] * q[1] + M[4], M[1] * q[0] + M[3] * q[1] + M[5]];
var inv = (M) => {
  const d = M[0] * M[3] - M[1] * M[2];
  return Math.abs(d) < 1e-12 ? null : [M[3] / d, -M[1] / d, -M[2] / d, M[0] / d, (M[2] * M[5] - M[3] * M[4]) / d, (M[1] * M[4] - M[0] * M[5]) / d];
};
function parseTransform(str) {
  let m = [1, 0, 0, 1, 0, 0];
  const re = /(\w+)\s*\(([^)]*)\)/g;
  let t;
  while (t = re.exec(str || "")) {
    const n = (t[2].match(NUM) || []).map(Number), a = (n[0] || 0) * Math.PI / 180;
    let q;
    switch (t[1]) {
      case "translate":
        q = [1, 0, 0, 1, n[0] || 0, n[1] || 0];
        break;
      case "scale":
        q = [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0];
        break;
      case "rotate": {
        const c = Math.cos(a), s = Math.sin(a), x = n[1] || 0, y = n[2] || 0;
        q = [c, s, -s, c, x - c * x + s * y, y - s * x - c * y];
        break;
      }
      case "skewX":
        q = [1, 0, Math.tan(a), 1, 0, 0];
        break;
      case "skewY":
        q = [1, Math.tan(a), 0, 1, 0, 0];
        break;
      case "matrix":
        q = n.length >= 6 ? n.slice(0, 6) : null;
        break;
      default:
        q = null;
    }
    if (q) m = mul(m, q);
  }
  return m;
}
var flt = (get, a) => parseFloat(get(a)) || 0;
function hullPts(tag, get, env) {
  if (tag === "path") {
    const out = [];
    let cur = [0, 0], start = [0, 0];
    for (const s of parsePath(get("d") || "")) {
      if (s.t === "Z") {
        cur = start;
        continue;
      }
      if (s.t === "M") start = s.pts[0];
      if (s.t === "A") {
        const q = arcGeom(cur, s.pts[0], ...s.arc);
        if (q) for (let k = 1; k < 24; k++) out.push(q.pt(q.th1 + q.dth * k / 24));
      }
      s.pts.forEach((q) => out.push(q));
      cur = s.pts.at(-1);
    }
    return out;
  }
  if (tag === "polygon" || tag === "polyline" || tag === "line") return readNodes(tag, get).pts;
  if (tag === "rect") {
    const x = flt(get, "x"), y = flt(get, "y"), w = flt(get, "width"), h = flt(get, "height");
    return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  }
  const b = env && env.bbox && env.bbox();
  return b ? [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]] : null;
}
function shapeBox(tag, get, env) {
  const M = parseTransform(get("transform"));
  if (tag === "circle" || tag === "ellipse") {
    const rx = Math.abs(tag === "circle" ? flt(get, "r") : flt(get, "rx")), ry = tag === "circle" ? rx : Math.abs(flt(get, "ry")), c = ap(M, [flt(get, "cx"), flt(get, "cy")]), hx = Math.hypot(M[0] * rx, M[2] * ry), hy = Math.hypot(M[1] * rx, M[3] * ry);
    return [c[0] - hx, c[1] - hy, c[0] + hx, c[1] + hy];
  }
  const pts = hullPts(tag, get, env);
  if (!pts || !pts.length) return null;
  const q = pts.map((r) => ap(M, r)), xs = q.map((r) => r[0]), ys = q.map((r) => r[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
var viol = (B, b, axis = "XY") => (axis !== "Y" ? Math.max(0, B[0] - b[0]) + Math.max(0, b[2] - B[2]) : 0) + (axis !== "X" ? Math.max(0, B[1] - b[1]) + Math.max(0, b[3] - B[3]) : 0);
var AXIS = { rect: { x: "X", width: "X", y: "Y", height: "Y" }, line: { x1: "X", x2: "X", y1: "Y", y2: "Y" }, ellipse: { cx: "X", rx: "X", cy: "Y", ry: "Y" }, circle: { cx: "X", cy: "Y", r: "XY" } };
var isGeo = (tag, a) => a === "transform" || !!(GEO[tag] && GEO[tag].includes(a));
var shiftPts = (segsOrPts, dx, dy) => segsOrPts.map((q) => [q[0] + dx, q[1] + dy]);
var fmtPts = (pts) => pts.map((q) => rnd(q[0]) + "," + rnd(q[1])).join(" ");
var bad = () => ({ ok: false, cap: "bounds", reason: "bounds" });
function fitBounds(p, tag, get, fin, attrs, isMove, env) {
  const B = p.bounds, val = (k) => fin.has(k) ? fin.get(k) : get(k);
  const bNew = shapeBox(tag, val, env), bOld = shapeBox(tag, get, env);
  if (!bNew || !bOld) return bad();
  const vOld = viol(B, bOld);
  if (viol(B, bNew) <= vOld + TOL) return { ok: true, values: fin };
  const out = new Map(fin), M = parseTransform(val("transform")), Mi = inv(M);
  const done = () => {
    const nb = shapeBox(tag, (k) => out.has(k) ? out.get(k) : get(k), env);
    return nb && viol(B, nb) <= vOld + TOL ? { ok: true, values: out } : bad();
  };
  const nodeAttr = NODE_ATTRS[tag] && tag !== "line" ? NODE_ATTRS[tag][0] : null;
  if (attrs.includes("transform")) {
    if (!isMove) return bad();
    const dx = bNew[0] < B[0] ? B[0] - bNew[0] : bNew[2] > B[2] ? B[2] - bNew[2] : 0, dy = bNew[1] < B[1] ? B[1] - bNew[1] : bNew[3] > B[3] ? B[3] - bNew[3] : 0;
    out.set("transform", "matrix(" + mul([1, 0, 0, 1, dx, dy], parseTransform(val("transform"))).map((v, i) => +v.toFixed(i < 4 ? 6 : 3)).join(" ") + ")");
    return done();
  }
  if (nodeAttr && attrs.includes(nodeAttr)) {
    if (!Mi) return bad();
    const nw = val(nodeAttr);
    if (isMove) {
      const dx = bNew[0] < B[0] ? B[0] - bNew[0] : bNew[2] > B[2] ? B[2] - bNew[2] : 0, dy = bNew[1] < B[1] ? B[1] - bNew[1] : bNew[3] > B[3] ? B[3] - bNew[3] : 0, ldx = Mi[0] * dx + Mi[2] * dy, ldy = Mi[1] * dx + Mi[3] * dy;
      out.set(nodeAttr, tag === "path" ? serPath(parsePath(nw).map((s) => ({ ...s, pts: shiftPts(s.pts, ldx, ldy) }))) : fmtPts(shiftPts(readNodes(tag, (k) => k === nodeAttr ? nw : get(k)).pts, ldx, ldy)));
      return done();
    }
    const clamp = (q, old) => {
      if (old && Math.abs(q[0] - old[0]) < 1e-9 && Math.abs(q[1] - old[1]) < 1e-9) return q;
      const w = ap(M, q);
      if (w[0] >= B[0] && w[0] <= B[2] && w[1] >= B[1] && w[1] <= B[3]) return q;
      return ap(Mi, [Math.min(B[2], Math.max(B[0], w[0])), Math.min(B[3], Math.max(B[1], w[1]))]);
    };
    if (tag === "path") {
      const segs = parsePath(nw), was = parsePath(get("d") || "");
      out.set("d", serPath(segs.map((s, i) => ({ ...s, pts: s.pts.map((q, k) => clamp(q, was[i] && was[i].pts[k])) }))));
    } else {
      const was = readNodes(tag, get).pts;
      out.set("points", fmtPts(readNodes(tag, (k) => k === nodeAttr ? nw : get(k)).pts.map((q, i) => clamp(q, was[i]))));
    }
    return done();
  }
  const ax = AXIS[tag], chg = ax ? attrs.filter((a) => ax[a]) : [];
  if (!chg.length) return bad();
  const o = {}, n = {};
  chg.forEach((a) => {
    o[a] = flt(get, a);
    n[a] = flt(val, a);
  });
  const aligned = Math.abs(M[1]) < 1e-9 && Math.abs(M[2]) < 1e-9, joint = !aligned || chg.some((a) => ax[a] === "XY");
  const groups = joint ? [{ attrs: chg, axis: "XY" }] : ["X", "Y"].map((g) => ({ attrs: chg.filter((a) => ax[a] === g), axis: g })).filter((g) => g.attrs.length);
  for (const g of groups) {
    const st = (t) => (k) => g.attrs.includes(k) ? String(o[k] + (n[k] - o[k]) * t) : chg.includes(k) ? String(n[k]) : val(k);
    const vo = viol(B, bOld, g.axis), ok = (t) => viol(B, shapeBox(tag, st(t), env), g.axis) <= vo + 1e-9;
    if (ok(1)) continue;
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) {
      const m = (lo + hi) / 2;
      ok(m) ? lo = m : hi = m;
    }
    g.attrs.forEach((a) => {
      n[a] = o[a] + (n[a] - o[a]) * lo;
    });
  }
  chg.forEach((a) => out.set(a, String(rnd(n[a]))));
  return done();
}
var SNAP_TOL = 6e-4;
var snapQ = (v, st) => Math.round(v / st) * st;
var moved = (a, b) => Math.abs(a - b) > SNAP_TOL;
function snapGroups(refs, S) {
  const groups = [];
  for (const r of refs) {
    const g = groups.find((g2) => Math.abs(g2.d[0] - r.d[0]) <= 15e-4 && Math.abs(g2.d[1] - r.d[1]) <= 15e-4);
    g ? g.m.push(r) : groups.push({ d: r.d, m: [r] });
  }
  for (const g of groups) {
    const ref = g.m.find((r) => r.anchor) || g.m[0], pt = ref.h.pts[ref.k], adj = [snapQ(pt[0], S[0]) - pt[0], snapQ(pt[1], S[1]) - pt[1]];
    g.m.forEach((r) => {
      const t = r.h.pts[r.k];
      r.h.pts[r.k] = [t[0] + adj[0], t[1] + adj[1]];
    });
  }
}
function snapChanges(p, tag, get, changes, env) {
  const S = p.snap, prop = /* @__PURE__ */ new Map();
  for (const c of changes) prop.set(c.attr, c.nw);
  if ([...prop.values()].some((v) => v === null)) return changes;
  const val = (k) => prop.has(k) ? prop.get(k) : get(k), out = /* @__PURE__ */ new Map();
  const put = (a, v) => {
    if (moved(v, prop.has(a) ? flt(val, a) : flt(get, a))) out.set(a, String(rnd(v)));
  };
  if (tag === "rect") {
    for (const [pos, size, st] of [["x", "width", S[0]], ["y", "height", S[1]]]) {
      if (!prop.has(pos) && !prop.has(size)) continue;
      const o0 = flt(get, pos), o1 = o0 + flt(get, size), n0 = flt(val, pos), n1 = n0 + flt(val, size), m0 = moved(n0, o0), m1 = moved(n1, o1);
      const rigid = m0 && m1 && !moved(n1 - n0, o1 - o0);
      const a = m0 ? snapQ(n0, st) : o0;
      let b = rigid ? a + (n1 - n0) : m1 ? snapQ(n1, st) : o1;
      if (!rigid && m1 && b - a <= 0 && n1 - n0 > 0) b = a + st;
      put(pos, a);
      put(size, b - a);
    }
  } else if (tag === "circle" || tag === "ellipse") {
    const ell = tag === "ellipse";
    for (const [pos, size, st, rad] of [["cx", ell ? "rx" : "r", S[0], true], ["cy", ell ? "ry" : "r", S[1], ell]]) {
      const c0 = flt(get, pos), c1 = flt(val, pos), r0 = flt(get, size), r1 = flt(val, size), cm = moved(c1, c0), c = cm ? snapQ(c1, st) : c0;
      if (cm) put(pos, c);
      if (rad && moved(r1, r0)) {
        let r = snapQ(c + r1, st) - c;
        if (r <= 0 && r1 > 0) r = st;
        put(size, r);
      }
    }
  } else if (tag === "line") {
    for (const [ks, st] of [[["x1", "x2"], S[0]], [["y1", "y2"], S[1]]]) {
      const o = ks.map((k) => flt(get, k)), n = ks.map((k) => flt(val, k)), m = [moved(n[0], o[0]), moved(n[1], o[1])];
      if (m[0] && m[1] && !moved(n[0] - o[0], n[1] - o[1])) {
        const sh = snapQ(n[0], st) - n[0];
        ks.forEach((k, i) => put(k, n[i] + sh));
      } else ks.forEach((k, i) => {
        if (m[i]) put(k, snapQ(n[i], st));
      });
    }
  } else if (tag === "path" && prop.has("d")) {
    const was = parsePath(get("d") || ""), now = parsePath(prop.get("d") || "");
    if (was.length === now.length && was.every((s, i) => s.t === now[i].t)) {
      const refs = [];
      now.forEach((s, i) => s.pts.forEach((pt, k) => {
        const o = was[i].pts[k], d = [pt[0] - o[0], pt[1] - o[1]];
        if (!moved(d[0], 0) && !moved(d[1], 0)) {
          s.pts[k] = [...o];
          return;
        }
        refs.push({ h: s, k, d, anchor: k === s.pts.length - 1 });
      }));
      if (refs.length) {
        snapGroups(refs, S);
        out.set("d", serPath(now));
      }
    }
  } else if ((tag === "polygon" || tag === "polyline") && prop.has("points")) {
    const was = readNodes(tag, get).pts, now = readNodes(tag, val).pts;
    if (was.length === now.length) {
      const h = { pts: now }, refs = [];
      now.forEach((pt, k) => {
        const d = [pt[0] - was[k][0], pt[1] - was[k][1]];
        if (!moved(d[0], 0) && !moved(d[1], 0)) {
          now[k] = [...was[k]];
          return;
        }
        refs.push({ h, k, d, anchor: true });
      });
      if (refs.length) {
        snapGroups(refs, S);
        out.set("points", fmtPts(now));
      }
    }
  }
  if (prop.has("transform") && changes.some((c) => c.attr === "transform" && [].concat(c.hint || []).includes("transform.move"))) {
    const M = parseTransform(prop.get("transform")), M0 = parseTransform(get("transform"));
    if (M.some((v, i) => moved(v, M0[i]))) {
      const b = env && env.bbox && env.bbox(), ref = b ? ap(M, [b[0], b[1]]) : [M[4], M[5]], sh = [snapQ(ref[0], S[0]) - ref[0], snapQ(ref[1], S[1]) - ref[1]];
      if (moved(sh[0], 0) || moved(sh[1], 0)) out.set("transform", "matrix(" + mul([1, 0, 0, 1, sh[0], sh[1]], M).map((v, i) => +v.toFixed(i < 4 ? 6 : 3)).join(" ") + ")");
    }
  }
  if (!out.size) return changes;
  const res = changes.map((c) => out.has(c.attr) ? { ...c, nw: out.get(c.attr) } : c);
  for (const [a, v] of out) if (!changes.some((c) => c.attr === a)) res.push({ attr: a, nw: v, hint: changes[0].hint });
  return res;
}
function checkOne(p, tag, get, attr, nw, hint) {
  const no = (cap, reason) => ({ ok: false, cap, reason });
  const kind = GEO[tag] && GEO[tag].includes(attr) ? "geom" : attr === "transform" ? "xform" : "attr";
  const need = hint ? [].concat(hint) : kind === "geom" ? ["geometry.edit"] : kind === "xform" ? XF : ["attrs.edit"];
  if (!need.some((c) => p.can(c))) return no(need[0], "capability");
  if (attr === MARKUP_ATTR) return no("attrs.edit", "attribute");
  if (kind === "attr" && !attrOk(p, attr, get(attr), nw)) return no("attrs.edit", "attribute");
  const v = rangeValue(p, attr, get(attr), nw);
  if (v === void 0) return no("range", "range");
  nw = v;
  if (NODE_ATTRS[tag] && NODE_ATTRS[tag].includes(attr)) {
    const a = readNodes(tag, get), b = readNodes(tag, (k) => k === attr ? nw : get(k));
    if (b.pts.length > a.pts.length && !p.can("nodes.insert")) return no("nodes.insert", "capability");
    if (b.pts.length < a.pts.length && !p.can("nodes.delete")) return no("nodes.delete", "capability");
    if (p.pin.length && !pinsHold(a, b, p.pin)) return no("pin", "pinned");
  }
  return { ok: true, value: nw };
}
function checkWrites(p, tag, get, changes, env) {
  if (p.snap) changes = snapChanges(p, tag, get, changes, env);
  const fin = /* @__PURE__ */ new Map();
  for (const c of changes) {
    const r = checkOne(p, tag, get, c.attr, c.nw, c.hint);
    if (!r.ok) return { ...r, attr: c.attr };
    fin.set(c.attr, r.value);
  }
  const geo = changes.filter((c) => isGeo(tag, c.attr));
  if (!p.bounds || !geo.length) return { ok: true, values: fin };
  const f2 = fitBounds(p, tag, get, fin, geo.map((c) => c.attr), geo.some((c) => [].concat(c.hint || []).includes("transform.move")), env);
  return f2.ok ? f2 : { ...f2, attr: geo[0].attr };
}
function canSet(p, tag, attr) {
  if (attr === MARKUP_ATTR) return false;
  if (attr.startsWith("style:")) return p.can("attrs.edit") && !p.denied("style") && p.propOk(attr.slice(6).toLowerCase());
  if (GEO[tag] && GEO[tag].includes(attr)) return p.can("geometry.edit");
  if (attr === "transform") return XF.some((c) => p.can(c));
  return p.can("attrs.edit") && (attr === "style" ? !p.denied("style") : p.propOk(attr));
}

// src/selection.js
function selection() {
  let kind = null;
  const set = /* @__PURE__ */ new Set();
  const api = {
    get kind() {
      return kind;
    },
    get size() {
      return set.size;
    },
    get items() {
      return [...set].sort((a, b) => a - b);
    },
    has: (k, i) => kind === k && set.has(i),
    only: (k, i) => kind === k && set.size === 1 && set.has(i),
    pick(k, i, add = false) {
      if (kind !== k || !add) {
        kind = k;
        set.clear();
        set.add(i);
        return;
      }
      set.has(i) ? set.delete(i) : set.add(i);
      if (!set.size) kind = null;
    },
    /* a press: picks now when the item isn't selected yet, and returns what a release without a drag should do. Pressing an
       item that is already selected leaves the selection alone, so the whole selection can be dragged; a click on it
       collapses to it (or, with shift, drops it). */
    press(k, i, add) {
      if (!api.has(k, i)) {
        api.pick(k, i, add);
        return () => {
        };
      }
      return () => api.pick(k, i, add);
    },
    clear() {
      kind = null;
      set.clear();
    },
    keep(k, ok) {
      if (kind !== k) return;
      for (const i of [...set]) if (!ok(i)) set.delete(i);
      if (!set.size) kind = null;
    }
  };
  return api;
}

// src/pen-math.js
var cp = (s) => ({ ...s, pts: s.pts.map((p) => [...p]), ...s.arc ? { arc: [...s.arc] } : {} });
var refl2 = (h, n) => [2 * n[0] - h[0], 2 * n[1] - h[1]];
var mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
var dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
var r3 = (n) => +n.toFixed(3);
function subOf(segs, j) {
  let m = j;
  while (m > 0 && segs[m].t !== "M") m--;
  let last = m, closed = false;
  for (let k = m + 1; k < segs.length && segs[k].t !== "M"; k++) {
    if (segs[k].t === "Z") {
      closed = true;
      break;
    }
    last = k;
  }
  return { m, last, closed };
}
function endKind(segs, j) {
  const s = segs[j];
  if (!s || s.t === "Z") return null;
  const { m, last, closed } = subOf(segs, j);
  if (closed) return null;
  return m === last ? j === m ? "lone" : null : j === last ? "end" : j === m ? "start" : null;
}
function reverseSub(segs, m) {
  const { last, closed } = subOf(segs, m);
  if (closed) return null;
  const n = last - m + 1, P = Array.from({ length: n }, (_, k) => segs[m + k].pts.at(-1)), out = segs.slice(0, m).map(cp);
  out.push({ t: "M", pts: [[...P[n - 1]]] });
  for (let k = n - 1; k >= 1; k--) {
    const s = segs[m + k], prev = [...P[k - 1]], nx = segs[m + k + 1], sm = k + 1 <= n - 1 && nx && nx.sm && nx.t === s.t;
    if (s.t === "L") out.push({ t: "L", pts: [prev], dirty: 1 });
    else if (s.t === "C") out.push({ t: "C", pts: [[...s.pts[1]], [...s.pts[0]], prev], ...sm ? { sm: 1 } : {} });
    else if (s.t === "Q") out.push({ t: "Q", pts: [[...s.pts[0]], prev], ...sm ? { sm: 1 } : {} });
    else if (s.t === "A") {
      const a = [...s.arc];
      a[4] = a[4] ? 0 : 1;
      out.push({ t: "A", arc: a, pts: [prev] });
    }
  }
  out.push(...segs.slice(last + 1).map(cp));
  return { segs: healSmooth(out), map: (i) => i >= m && i <= last ? m + (last - i) : i };
}
function penNode(segs, head, p, o = {}) {
  const kind = o.kind || "auto", h = o.drag || null, from = segs[head].pts.at(-1), drag = !!h && dist(h, p) > 1e-9, prevC = segs[head].t === "C";
  if (dist(from, p) < 1e-9) return null;
  const out = o.out || null, sym = drag && !o.alt, mirror = !!out && out.sym && prevC;
  let s, nout = null;
  if (kind === "Q") s = { t: "Q", pts: [drag ? [...h] : out ? [...out.pt] : mid(from, p), [...p]] };
  else if (kind === "A") {
    const a = drag && arcThrough(from, h, p);
    s = a ? { t: "A", arc: a.map(r3), pts: [[...p]] } : convertSegment([...segs.slice(0, head + 1), { t: "L", pts: [[...p]] }], head + 1, "A")[0];
  } else if (kind === "C" || kind === "auto" && (out || sym)) {
    s = { t: "C", pts: [mirror ? refl2(segs[head].pts[1], from) : out ? [...out.pt] : [...from], sym ? refl2(h, p) : [...p], [...p]], ...mirror ? { sm: 1 } : {} };
  } else s = kind === "L" || kind === "auto" ? { t: "L", pts: [[...p]] } : null;
  if (drag && (kind === "auto" || kind === "C")) nout = { pt: [...h], sym };
  if (!s) return null;
  const res = segs.map(cp);
  res.splice(head + 1, 0, { ...s, dirty: 1 });
  return { segs: healSmooth(res), idx: head + 1, out: nout };
}
function canClose(segs, head) {
  const { m, last, closed } = subOf(segs, head);
  return !closed && head === last && last > m;
}
function closeSub(segs, head, o = {}) {
  if (!canClose(segs, head)) return null;
  const { m } = subOf(segs, head), kind = o.kind || "auto", curved = kind === "Q" || kind === "C" || kind === "A" || kind === "auto" && (o.out || o.drag);
  let res = segs, at = head;
  if (curved) {
    const r = penNode(segs, head, segs[m].pts[0], { kind, out: o.out, drag: o.drag });
    if (r) {
      res = r.segs;
      at = r.idx;
    }
  }
  res = res.map(cp);
  res.splice(at + 1, 0, { t: "Z", pts: [] });
  return { segs: healSmooth(res), idx: m };
}

// src/widgets/path.js
Widgets.register((el) => el.tagName === "path", (ctx) => {
  const el = ctx.el, g = mk("g");
  ctx.overlay.append(g);
  let segs = parsePath(el.getAttribute("d") || ""), items = [], lines = [], hit, gh, sg, pv, dead = false, mv0 = false, mv1 = false, arcs = [], pinned = /* @__PURE__ */ new Set();
  const S = selection();
  const f2 = (v) => +v.toFixed(3), A2 = (e, o) => {
    for (const k in o) e.setAttribute(k, o[k]);
  };
  const ser = () => serPath(segs);
  let uid = 0, segAt = 0;
  const T0 = (p) => {
    const q = new DOMPoint(p[0], p[1]).matrixTransform(ctx.matrix());
    return [q.x, q.y];
  };
  const sync = () => {
    const n = parsePath(el.getAttribute("d") || "");
    if (n.length !== segs.length || n.some((q, i) => q.t !== segs[i].t)) {
      segs = n;
      build();
      return;
    }
    n.forEach((q, i) => {
      segs[i].pts = q.pts;
      if (q.arc) segs[i].arc = q.arc;
      if (q.sm) segs[i].sm = 1;
      else delete segs[i].sm;
    });
  };
  const write = (own) => {
    fixSmooth(segs);
    retype(segs);
    const v = ser(), r = own ? ctx.batch(() => ctx.set("d", v), own) : ctx.set("d", v);
    if (r === false) {
      segs = parsePath(el.getAttribute("d") || "");
      build();
      return false;
    }
    if (el.getAttribute("d") !== v) sync();
    return true;
  };
  const prevPt = (i) => {
    for (let j = i - 1; j >= 0; j--) if (segs[j].t !== "Z") return segs[j].pts.at(-1);
    return segs[i].pts[0];
  };
  const startOf = (i) => {
    for (let j = i; j >= 0; j--) if (segs[j].t === "M") return segs[j].pts[0];
  };
  const pnode = (i) => {
    for (let j = i - 1; j >= 0; j--) if (segs[j].t !== "Z") return j;
    return -1;
  };
  const on = (i, w) => S.has("seg", i) || w !== 1 && S.has("node", pnode(i)) || w !== 0 && S.has("node", i);
  function bind(h, onStart, onMove, onClick) {
    h.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      h.setPointerCapture(e.pointerId);
      const p0 = ctx.toLocal(e);
      onStart(p0, e);
      mv0 = mv1;
      mv1 = false;
      const mv = (ev) => {
        if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > 3) mv1 = true;
        onMove(ctx.toLocal(ev), p0, ev);
        write();
        layout();
      };
      h.addEventListener("pointermove", mv);
      h.addEventListener("pointerup", () => {
        h.removeEventListener("pointermove", mv);
        if (!mv1 && onClick) onClick();
      }, { once: true });
    });
  }
  function ctl(s, k, i, w) {
    const h = mk("circle", { style: "pointer-events:all;cursor:move", fill: "var(--acc,#2f6fed)" });
    items.push({ el: h, get: () => s.pts[k], r: 3.5, vis: () => on(i, w) });
    gh.append(h);
    let links = [];
    bind(h, () => {
      links = handleLinks(segs, i, k);
    }, (p, p0, ev) => {
      dragHandle(segs, i, k, p, links, ev.altKey ? "free" : ev.shiftKey ? "sym" : null);
    });
  }
  function node(s, i) {
    const h = mk("rect", { style: "pointer-events:all;cursor:move", fill: "var(--panel,#fff)", stroke: "var(--acc,#2f6fed)" }), pin = pinned.has(i);
    items.push({ el: h, get: () => s.pts.at(-1), r: 5, n: 1, node: i, pin });
    gh.append(h);
    if (pin) {
      h.style.cursor = "not-allowed";
      h.setAttribute("fill", "#ddd");
      h.setAttribute("stroke", "#888");
      h.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        S.pick("node", i, e.shiftKey);
        layout();
      });
      return;
    }
    let refs = [], rel = () => {
    }, wasHead = false;
    bind(h, (p0, e) => {
      if (ctx.penOn) {
        const v = view();
        wasHead = head() === i;
        if (v && !wasHead && canClose(v.segs, v.head) && subOf(v.segs, v.head).m === v.map(i) && allowed()) {
          closeGesture(e, v);
          return;
        }
      }
      rel = S.press("node", i, e.shiftKey);
      layout();
      refs = [];
      for (const j of S.items) {
        const q = segs[j];
        if (!q || q.t === "Z" || pinned.has(j)) continue;
        const nx = segs[j + 1];
        refs.push([q, q.pts.length - 1]);
        if (q.t === "C") refs.push([q, 1]);
        if (nx?.t === "C") refs.push([nx, 0]);
        if (q.t === "L") q.dirty = 1;
        if (nx?.t === "L") nx.dirty = 1;
      }
      refs = refs.map(([q, k]) => [q, k, [...q.pts[k]]]);
    }, (p, p0) => {
      const dx = p[0] - p0[0], dy = p[1] - p0[1];
      refs.forEach(([q, k, o]) => q.pts[k] = [o[0] + dx, o[1] + dy]);
    }, () => {
      rel();
      layout();
      if (wasHead && ctx.penOn) ctx.penFinish();
    });
    h.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      if (mv0 || mv1 || ctx.penOn) return;
      S.pick("node", i);
      del();
    });
  }
  function del() {
    if (!S.size || !ctx.can("nodes.delete")) return false;
    const r = S.kind === "seg" ? ctx.pin.length ? null : deleteSegments(segs, S.items) : deleteNodes(segs, S.items, pinned);
    if (!r) return false;
    segs = r;
    S.clear();
    healSmooth(segs);
    write("del:" + ++uid);
    build();
    return true;
  }
  function insert(p) {
    const best = nearestSeg(segs, p, { arcs: false });
    if (!best) return;
    const { i, t, cp: cp2 } = best, s = segs[i], [L, R2] = split(cp2, t);
    if (s.t === "Z") segs.splice(i, 0, { t: "L", pts: [L.at(-1)], dirty: 1 });
    else segs.splice(i, 1, { t: s.t, pts: L.slice(1), dirty: 1 }, { t: s.t, pts: R2.slice(1), dirty: 1 });
    S.pick("node", i);
    healSmooth(segs);
    write();
    build();
  }
  const geom = (i) => {
    const s = segs[i];
    return s && s.t === "A" ? arcGeom(prevPt(i), s.pts[0], ...s.arc) : null;
  };
  const GAP = 16, gapL = () => {
    const M = ctx.matrix();
    return ctx.px(GAP) / (Math.hypot(M.a, M.b) || 1);
  };
  const ln = (a, b, o = {}) => {
    const l = mk("line", { stroke: "var(--acc,#2f6fed)", opacity: o.op || 0.55 });
    lines.push({ el: l, a, b, ...o });
    g.append(l);
  };
  const ends = (i, k, out) => () => {
    const q = geom(i);
    if (!q) return null;
    const d = (k ? q.ry : q.rx) + out * gapL();
    return k ? [q.cx - d * q.s, q.cy + d * q.c] : [q.cx + d * q.c, q.cy + d * q.s];
  };
  const ctr = (i) => () => {
    const q = geom(i);
    return q && [q.cx, q.cy];
  };
  function arcHandles(s, i) {
    const mkh = (fill, cur) => {
      const h = mk("circle", { style: "pointer-events:all;cursor:" + cur, fill, stroke: "var(--acc,#2f6fed)" });
      gh.append(h);
      return h;
    };
    const acc = "var(--acc,#2f6fed)", P = () => prevPt(i);
    arcs.push({ i, ell: g.appendChild(mk("ellipse", { fill: "none", stroke: acc, opacity: 0.6, "vector-effect": "non-scaling-stroke", "stroke-dasharray": "5 3" })) });
    ln(ctr(i), ends(i, 0, 1), { vis: () => on(i), dash: 1, op: 0.8 });
    ln(ctr(i), ends(i, 1, 1), { vis: () => on(i), dash: 1, op: 0.8 });
    const rotPos = () => {
      const q = geom(i);
      if (!q) return null;
      const d = q.rx + gapL();
      return [q.cx - d * q.c, q.cy - d * q.s];
    };
    ln(() => {
      const q = geom(i);
      return q && [q.cx - q.rx * q.c, q.cy - q.rx * q.s];
    }, rotPos, { vis: () => on(i) });
    const drag = (h, pos, kind, r, fill) => {
      items.push({ el: h, vis: () => on(i), r, get: pos });
      let off = [0, 0];
      bind(
        h,
        (p0) => {
          const c = pos();
          off = c ? [p0[0] - c[0], p0[1] - c[1]] : [0, 0];
        },
        (p, p0, ev) => {
          s.arc = arcFit(P(), s.pts[0], s.arc, kind, [p[0] - off[0], p[1] - off[1]], { gap: kind === "rot" ? 0 : gapL(), shift: ev.shiftKey });
        }
      );
    };
    drag(mkh(acc, "move"), ends(i, 0, 1), "rx", 4.5);
    drag(mkh(acc, "move"), ends(i, 1, 1), "ry", 4.5);
    drag(mkh("var(--panel,#fff)", "grab"), rotPos, "rot", 4.5);
    const hm = mkh(acc, "move");
    items.push({ el: hm, vis: () => on(i), r: 4.5, get: () => {
      const q = geom(i);
      return q && q.pt(q.th1 + q.dth / 2);
    } });
    let offm = [0, 0];
    bind(
      hm,
      (p0) => {
        const c = geom(i) && geom(i).pt(geom(i).th1 + geom(i).dth / 2);
        offm = c ? [p0[0] - c[0], p0[1] - c[1]] : [0, 0];
      },
      (p) => {
        s.arc = arcFit(P(), s.pts[0], s.arc, "flip", [p[0] - offm[0], p[1] - offm[1]]);
      }
    );
  }
  function build() {
    g.replaceChildren();
    items = [];
    lines = [];
    arcs = [];
    const pn = pathNodes(segs);
    pinned = new Set(pinnedIdx(pn, ctx.pin).map((k) => pn.seg[k]));
    healSmooth(segs);
    S.keep("node", (i) => segs[i] && segs[i].t !== "Z");
    S.keep("seg", (i) => segs[i] && segs[i].t !== "M");
    hit = mk("path", { fill: "none", stroke: "transparent", "stroke-width": 12, "vector-effect": "non-scaling-stroke", style: "pointer-events:stroke;cursor:" + (ctx.can("nodes.insert") ? "copy" : "move") });
    hit.addEventListener("dblclick", (e) => ctx.can("nodes.insert") && insert(ctx.toLocal(e)));
    hit.addEventListener("pointerdown", (e) => {
      const k = nearestSeg(segs, ctx.toLocal(e)), i = k ? k.i : -1, add = e.shiftKey;
      ctx.grab(e, { click: () => {
        if (i < 0 || !segs[i] || segs[i].t === "M") return;
        const now = performance.now();
        if (!add && S.only("seg", i)) {
          if (now - segAt > 500) {
            S.clear();
            layout();
          }
          return;
        }
        segAt = now;
        S.pick("seg", i, add);
        layout();
      } });
    });
    g.append(hit);
    sg = g.appendChild(mk("g", { style: "pointer-events:none" }));
    pv = g.appendChild(mk("path", { fill: "none", stroke: "var(--acc,#2f6fed)", "stroke-dasharray": "5 4", "vector-effect": "non-scaling-stroke", style: "pointer-events:none;display:none" }));
    gh = mk("g");
    segs.forEach((s, i) => {
      if (s.t === "C") {
        ln(() => prevPt(i), () => s.pts[0], { vis: () => on(i, 0) });
        ln(() => s.pts[1], () => s.pts[2], { vis: () => on(i, 1) });
        ctl(s, 0, i, 0);
        ctl(s, 1, i, 1);
      }
      if (s.t === "Q") {
        ln(() => prevPt(i), () => s.pts[0], { vis: () => on(i) });
        ln(() => s.pts[0], () => s.pts[1], { vis: () => on(i) });
        ctl(s, 0, i);
      }
      if (s.t === "A") arcHandles(s, i);
    });
    segs.forEach((s, i) => s.t !== "Z" && node(s, i));
    pendUI();
    g.append(gh);
    layout();
  }
  function layout() {
    const M = ctx.matrix(), T = (p) => {
      const q = new DOMPoint(p[0], p[1]).matrixTransform(M);
      return [q.x, q.y];
    }, info = segInfo(segs), types = segs.map((_, j) => nodeType(segs, j, info)), w = ctx.px(1.5);
    A2(hit, { d: ser(), transform: `matrix(${M.a} ${M.b} ${M.c} ${M.d} ${M.e} ${M.f})` });
    lines.forEach((l) => {
      const a0 = l.a(), b0 = l.b(), show = a0 && b0 && (!l.vis || l.vis());
      l.el.style.display = show ? "" : "none";
      if (!show) return;
      const a = T(a0), b = T(b0);
      A2(l.el, { x1: a[0], y1: a[1], x2: b[0], y2: b[1], "stroke-width": ctx.px(1), "stroke-dasharray": l.dash ? ctx.px(2) + " " + ctx.px(3) : "none" });
    });
    items.forEach((it) => {
      const pt = it.vis && !it.vis() ? null : it.get();
      it.el.style.display = pt ? "" : "none";
      if (!pt) return;
      const [x, y] = T(pt), r = ctx.px(it.r);
      A2(it.el, it.n ? { x: x - r, y: y - r, width: 2 * r, height: 2 * r, "stroke-width": w } : { cx: x, cy: y, r, "stroke-width": w });
      if (it.n) {
        const ty = types[it.node], rx = ty === "symmetric" ? r : ty === "smooth" ? r * 0.45 : 0;
        it.el.setAttribute("rx", rx);
        it.el.setAttribute("ry", rx);
        const sl = S.has("node", it.node);
        if (it.pin) it.el.setAttribute("stroke", sl ? "var(--acc,#2f6fed)" : "#888");
        else it.el.setAttribute("fill", sl ? "var(--acc,#2f6fed)" : "var(--panel,#fff)");
      }
    });
    sg.replaceChildren(...(S.kind === "seg" ? S.items : []).map((i) => segD(segs, i)).filter(Boolean).map((d) => mk("path", { d, fill: "none", stroke: "var(--acc,#2f6fed)", opacity: 0.45, "stroke-width": 6, "stroke-linecap": "round", "vector-effect": "non-scaling-stroke", transform: `matrix(${M.a} ${M.b} ${M.c} ${M.d} ${M.e} ${M.f})` })));
    arcs.forEach(({ i, ell }) => {
      const q = on(i) && geom(i);
      ell.style.display = q ? "" : "none";
      if (q) A2(ell, { rx: q.rx, ry: q.ry, transform: `matrix(${M.a} ${M.b} ${M.c} ${M.d} ${M.e} ${M.f}) translate(${q.cx} ${q.cy}) rotate(${q.phi * 180 / Math.PI})` });
    });
  }
  let drawM = null;
  const pends = [];
  const head = () => S.kind === "node" && S.size === 1 && endKind(segs, S.items[0]) ? S.items[0] : -1;
  const same2 = (a, b) => Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01;
  const setPend = (q, out) => {
    const i = pends.findIndex((r) => same2(r.at, q));
    if (i >= 0) pends.splice(i, 1);
    if (out) pends.push({ at: [...q], out });
  };
  const pendNow = () => {
    const h = head(), r = h >= 0 && pends.find((r2) => same2(r2.at, segs[h].pts.at(-1)));
    return r ? r.out : null;
  };
  function view() {
    const h = head();
    if (h < 0) return null;
    if (endKind(segs, h) === "start") {
      const r = reverseSub(segs, h);
      if (r) return { segs: r.segs, head: r.map(h), map: r.map };
    }
    return { segs, head: h, map: (i) => i };
  }
  function allowed() {
    const c = !ctx.can("geometry.edit") ? "geometry.edit" : !ctx.can("nodes.insert") ? "nodes.insert" : null;
    if (c) {
      ctx.deny(c, "capability");
      return false;
    }
    if (ctx.pin.length) {
      ctx.deny("nodes.insert", "pinned");
      return false;
    }
    return true;
  }
  function pendUI() {
    ln(() => pendNow() && segs[head()].pts.at(-1), () => pendNow() && pendNow().pt, {});
    const h = mk("circle", { style: "pointer-events:all;cursor:move", fill: "var(--panel,#fff)", stroke: "var(--acc,#2f6fed)" });
    items.push({ el: h, get: () => ctx.penOn && pendNow() ? pendNow().pt : null, r: 3.5 });
    gh.append(h);
    bind(h, () => {
    }, (p) => {
      const q = pendNow(), k = head();
      if (!q) return;
      q.pt = p;
      const s = segs[k];
      if (q.sym && s.t === "C") s.pts[1] = [2 * s.pts[2][0] - p[0], 2 * s.pts[2][1] - p[1]];
    });
  }
  function restoreHead() {
    if (drawM === null || !segs[drawM] || segs[drawM].t !== "M") return;
    const { last, closed } = subOf(segs, drawM);
    if (!closed) {
      S.clear();
      S.pick("node", last);
      layout();
    }
  }
  function doClose(v) {
    const r = closeSub(v.segs, v.head, { kind: ctx.penSeg, out: pendNow() });
    if (!r) return false;
    segs = r.segs;
    S.clear();
    pends.length = 0;
    drawM = null;
    write("penc:" + ++uid);
    build();
    return true;
  }
  function closeGesture(e, v) {
    const key = "penc:" + ++uid, thr = e.pointerType === "touch" ? 8 : 3, x0 = e.clientX, y0 = e.clientY, out = pendNow();
    let dragging = false;
    const run = (h) => {
      const r = closeSub(v.segs, v.head, { kind: ctx.penSeg, out, drag: h });
      if (!r) return false;
      segs = r.segs;
      S.clear();
      pends.length = 0;
      drawM = null;
      if (!write(key)) return false;
      build();
      return true;
    };
    if (!run(null)) return;
    const mv = (ev) => {
      if (dead) return up();
      if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) <= thr) return;
      dragging = true;
      run(ctx.fit(ctx.toLocal(ev)));
    };
    const up = () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }
  const pen = {
    canContinue: () => head() >= 0,
    canClose() {
      const v = view();
      return !!v && canClose(v.segs, v.head) && ctx.can("nodes.insert") && !ctx.pin.length;
    },
    close() {
      const v = view();
      return !!v && allowed() && doClose(v);
    },
    clear() {
      S.clear();
      pends.length = 0;
      drawM = null;
      layout();
    },
    // the path is done: no node selected, so the next press starts a new one
    hover(e) {
      const v = e && ctx.penOn ? view() : null, r = v && penNode(v.segs, v.head, ctx.fit(ctx.toLocal(e)), { kind: ctx.penSeg, out: pendNow() }), d = r && segD(r.segs, r.idx);
      if (!d) {
        pv.style.display = "none";
        return;
      }
      const M = ctx.matrix();
      A2(pv, { d, transform: `matrix(${M.a} ${M.b} ${M.c} ${M.d} ${M.e} ${M.f})` });
      pv.style.display = "";
    },
    /* a press: -> a gesture {move, end, cancel} like a creation tool's, or null when refused. o.first: the shape was just made empty for this press
       (its first node); o.key: the undo key every write of this press shares (and the shape's creation, when it is the first) */
    begin(e, o) {
      pv.style.display = "none";
      const key = o.key, thr = e.pointerType === "touch" ? 8 : 3, x0 = e.clientX, y0 = e.clientY, h0 = head(), sig = (q) => q.map((z) => z.t).join("");
      let p = ctx.fit(ctx.toLocal(e)), dragging = false, wrote = false, dead2 = false, newPt = null;
      if (o.first) {
        segs = [{ t: "M", pts: [p] }];
        drawM = 0;
        pends.length = 0;
        if (!write(key) || !segs.length) return null;
        wrote = true;
        S.pick("node", 0);
        build();
        return { move(_, ev) {
          if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) <= thr) return;
          dragging = true;
          setPend(segs[0].pts[0], { pt: ctx.fit(ctx.toLocal(ev)), sym: false });
          layout();
        }, end() {
          layout();
          return null;
        }, cancel() {
          ctx.undo();
        } };
      }
      if (!allowed()) return null;
      const v = view();
      if (!v) return null;
      const base = v.segs, hd = v.head, out = pendNow();
      const apply = (h, alt) => {
        const r = penNode(base, hd, p, { kind: ctx.penSeg, out, drag: h, alt });
        if (!r) {
          dead2 = true;
          return;
        }
        const was = sig(segs);
        segs = r.segs;
        S.pick("node", r.idx);
        drawM = subOf(segs, r.idx).m;
        if (!write(key)) {
          dead2 = true;
          return;
        }
        wrote = true;
        const nd = segs[r.idx];
        newPt = [...nd.pts.at(-1)];
        setPend(newPt, r.out && { pt: r.out.pt, sym: r.out.sym });
        sig(segs) !== was ? build() : layout();
      };
      apply(null, false);
      if (dead2) return null;
      return { move(_, ev) {
        if (dead2) return;
        if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) <= thr) return;
        dragging = true;
        apply(ctx.fit(ctx.toLocal(ev)), ev.altKey);
      }, end() {
        layout();
        return null;
      }, cancel() {
        if (wrote) ctx.undo();
        if (newPt) setPend(newPt, null);
        S.pick("node", h0);
        layout();
      } };
    }
  };
  function setType(js, type) {
    let out = segs;
    for (const j of js) {
      const r = setNodeType(out, j, type);
      if (r) out = r;
    }
    if (out === segs) return;
    segs = out;
    write("type:" + ++uid);
    build();
  }
  function setSegType(js, type) {
    const r = convertSegments(segs, js, type);
    if (!r) return;
    segs = r.segs;
    S.clear();
    r.sel.forEach((i) => S.pick("seg", i, true));
    if (ctx.penOn) {
      const k = r.sel.at(-1);
      if (endKind(segs, k) === "end") {
        S.clear();
        S.pick("node", k);
      }
    }
    write("seg:" + ++uid);
    build();
  }
  ctx.menu(({ x, y }) => {
    if (!ctx.can("geometry.edit")) return [];
    const o = ctx.toOverlay({ clientX: x, clientY: y }), at = segs.findIndex((q, j) => q.t !== "Z" && Math.hypot(...T0(segs[j].pts.at(-1)).map((v, k) => v - o[k])) <= ctx.px(9));
    if (at >= 0 && !S.has("node", at)) {
      S.pick("node", at);
      layout();
    } else if (at < 0 && document.elementFromPoint(x, y) === hit) {
      const k = nearestSeg(segs, ctx.toLocal({ clientX: x, clientY: y }));
      if (k && !S.has("seg", k.i)) {
        S.pick("seg", k.i);
        layout();
      }
    }
    if (S.kind === "seg") {
      const js2 = S.items.filter((j) => segs[j] && segs[j].t !== "M" && segs[j].t !== "Z"), cur = new Set(js2.map((j) => segs[j].t));
      if (!js2.length) return [];
      const it2 = (label, t) => {
        const r = convertSegments(segs, js2, t);
        return { label, checked: cur.size === 1 && cur.has(t), disabled: !!r && r.segs.length > segs.length && !ctx.can("nodes.insert"), action: () => setSegType(js2, t) };
      };
      return [{ label: "Segment type", submenu: [it2("Line", "L"), it2("Quadratic curve", "Q"), it2("Cubic curve", "C"), it2("Arc", "A")] }];
    }
    const info = segInfo(segs), js = (S.kind === "node" ? S.items : []).filter((j) => nodeType(segs, j, info)), ts = new Set(js.map((j) => nodeType(segs, j, info)));
    if (!js.length) return [];
    const it = (label, t) => ({ label, checked: ts.size === 1 && ts.has(t), action: () => setType(js, t) });
    return [{ label: "Node type", submenu: [it("Corner", "corner"), it("Smooth", "smooth"), it("Symmetric", "symmetric")] }];
  });
  ctx.on("view", () => !dead && layout());
  ctx.on("key", (d) => {
    if (dead || d.handled || !S.size) return;
    if (d.key === "Escape") {
      if (ctx.penOn) return;
      S.clear();
      layout();
      d.handled = true;
    } else if (d.key === "Delete" || d.key === "Backspace") {
      del();
      d.handled = true;
    }
  });
  ctx.on("change", ({ el: e, src }) => {
    if (dead || e !== el || src === "widget") return;
    segs = parsePath(el.getAttribute("d") || "");
    build();
    if (ctx.penOn) restoreHead();
  });
  build();
  return {
    update() {
      segs = parsePath(el.getAttribute("d") || "");
      build();
    },
    destroy() {
      dead = true;
      g.remove();
    },
    pen,
    deleteSelection: del,
    clearSelection() {
      S.clear();
      layout();
    },
    get selection() {
      return S.size ? { kind: S.kind === "seg" ? "segment" : "node", items: S.items } : null;
    }
  };
});

// src/widgets/handle.js
function handleWidget(ctx, specs, outline) {
  const g = mk("g"), A2 = (e, o) => {
    for (const k in o) e.setAttribute(k, o[k]);
  };
  ctx.overlay.append(g);
  let dead = false;
  const ols = [];
  const items = specs.map((sp) => {
    const el = mk(sp.sq ? "rect" : "circle", { style: "pointer-events:all;cursor:move", fill: sp.sq ? "var(--panel,#fff)" : "var(--acc,#2f6fed)", stroke: "var(--acc,#2f6fed)" });
    g.append(el);
    el.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      if (sp.locked && sp.locked()) return;
      el.setPointerCapture(e.pointerId);
      const p0 = ctx.toLocal(e);
      sp.start && sp.start(p0);
      const mv = (ev) => sp.drag(ctx.toLocal(ev), p0, ev);
      el.addEventListener("pointermove", mv);
      el.addEventListener("pointerup", () => el.removeEventListener("pointermove", mv), { once: true });
    });
    return { el, sp };
  });
  function layout() {
    const M = ctx.matrix(), T = (p) => {
      const q = new DOMPoint(p[0], p[1]).matrixTransform(M);
      return [q.x, q.y];
    }, w = ctx.px(1.5);
    if (outline) {
      const o = outline(), polys = Array.isArray(o[0][0]) ? o : [o];
      polys.forEach((poly, i) => {
        if (!ols[i]) {
          ols[i] = mk("polygon", { fill: "none", stroke: "var(--acc,#2f6fed)" });
          g.insertBefore(ols[i], g.firstChild);
        }
        A2(ols[i], { points: poly.map(T).join(" "), "stroke-width": w, "stroke-dasharray": i ? ctx.px(1.5) + " " + ctx.px(2.5) : ctx.px(5) + " " + ctx.px(3) });
      });
    }
    items.forEach(({ el, sp }) => {
      const [x, y] = T(sp.get()), r = ctx.px(sp.sq ? 5 : 4.5), lk = sp.locked && sp.locked();
      el.style.cursor = lk ? "not-allowed" : "move";
      el.setAttribute("fill", lk ? "#ddd" : sp.sq ? "var(--panel,#fff)" : "var(--acc,#2f6fed)");
      el.setAttribute("stroke", lk ? "#888" : "var(--acc,#2f6fed)");
      A2(el, sp.sq ? { x: x - r, y: y - r, width: 2 * r, height: 2 * r, "stroke-width": w } : { cx: x, cy: y, r, "stroke-width": w });
    });
  }
  ctx.on("view", () => !dead && layout());
  ctx.on("change", () => !dead && layout());
  layout();
  return { update: layout, destroy() {
    dead = true;
    g.remove();
  } };
}

// src/widgets/shapes.js
Widgets.register((el) => el.tagName === "rect", (ctx) => {
  const el = ctx.el, rect = () => ({ x: num(el, "x"), y: num(el, "y"), w: num(el, "width"), h: num(el, "height") });
  let A2, B, a0, b0, rr0, busy = false, w;
  const fromAB = () => ({ x: Math.min(A2[0], B[0]), y: Math.min(A2[1], B[1]), w: Math.abs(A2[0] - B[0]), h: Math.abs(A2[1] - B[1]) });
  const sync = () => {
    if (busy) return;
    const r = rect(), q = A2 && fromAB();
    if (!q || Math.abs(q.x - r.x) + Math.abs(q.y - r.y) + Math.abs(q.w - r.w) + Math.abs(q.h - r.h) > 2e-3) {
      A2 = [r.x, r.y];
      B = [r.x + r.w, r.y + r.h];
    }
  };
  const write = () => {
    const q = fromAB();
    busy = true;
    try {
      ctx.batch(() => {
        ctx.set("x", rnd(q.x));
        ctx.set("y", rnd(q.y));
        ctx.set("width", rnd(q.w));
        ctx.set("height", rnd(q.h));
      });
    } finally {
      busy = false;
    }
    sync();
    w && w.update();
  };
  const radii = () => {
    const r = rect(), a = parseFloat(el.getAttribute("rx")), b = parseFloat(el.getAttribute("ry")), rx = a >= 0 ? a : b >= 0 ? b : 0, ry = b >= 0 ? b : a >= 0 ? a : 0;
    return [Math.min(rx, r.w / 2), Math.min(ry, r.h / 2)];
  };
  const corner = () => {
    sync();
    const r = rect(), ax = A2[0] <= B[0] ? 0 : 1, ay = A2[1] <= B[1] ? 0 : 1, fx = ay ? ax : 1 - ax;
    return { cx: r.x + r.w * fx, cy: r.y, sx: fx ? -1 : 1 };
  };
  const node = (get, set) => ({ sq: 1, get: () => {
    sync();
    return get();
  }, start: () => {
    sync();
    a0 = [...A2];
    b0 = [...B];
  }, drag: (p, p0) => {
    set(p[0] - p0[0], p[1] - p0[1]);
    write();
  } });
  const specs = [
    node(() => A2, (dx, dy) => {
      A2 = [rnd(a0[0] + dx), rnd(a0[1] + dy)];
    }),
    node(() => B, (dx, dy) => {
      B = [rnd(b0[0] + dx), rnd(b0[1] + dy)];
    }),
    {
      get: () => {
        const c = corner(), [rx, ry] = radii();
        return [c.cx + c.sx * rx, c.cy + ry];
      },
      start: () => {
        rr0 = radii();
      },
      drag: (p, p0, ev) => {
        const r = rect(), c = corner();
        let rx = rr0[0] + (p[0] - p0[0]) * c.sx, ry = rr0[1] + (p[1] - p0[1]);
        rx = Math.max(0, Math.min(rx, r.w / 2));
        ry = Math.max(0, Math.min(ry, r.h / 2));
        if (ev && ev.shiftKey) rx = ry = Math.min((rx + ry) / 2, r.w / 2, r.h / 2);
        ctx.set("rx", rnd(rx));
        ctx.set("ry", rnd(ry));
      }
    }
  ];
  return w = handleWidget(ctx, specs, () => {
    const r = rect(), c = corner(), [rx, ry] = radii();
    return [box4(r.x, r.y, r.w, r.h), [[c.cx, c.cy], [c.cx + c.sx * rx, c.cy], [c.cx + c.sx * rx, c.cy + ry], [c.cx, c.cy + ry]]];
  });
});
for (const tag of ["circle", "ellipse"]) Widgets.register((el) => el.tagName === tag, (ctx) => {
  const el = ctx.el, c = () => [num(el, "cx"), num(el, "cy")], ell = tag === "ellipse";
  const rx = () => num(el, ell ? "rx" : "r"), ry = () => num(el, ell ? "ry" : "r");
  const specs = [
    { sq: 1, get: () => [c()[0] + rx(), c()[1]], drag: (p) => ctx.set(ell ? "rx" : "r", rnd(ell ? Math.abs(p[0] - c()[0]) : Math.hypot(p[0] - c()[0], p[1] - c()[1]))) }
  ];
  if (ell) specs.push({ sq: 1, get: () => [c()[0], c()[1] + ry()], drag: (p) => ctx.set("ry", rnd(Math.abs(p[1] - c()[1]))) });
  return handleWidget(ctx, specs, () => box4(c()[0] - rx(), c()[1] - ry(), 2 * rx(), 2 * ry()));
});
Widgets.register((el) => el.tagName === "line", (ctx) => {
  const el = ctx.el, P = (a, b) => [num(el, a), num(el, b)], pin = (i) => pinnedIdx(polyNodes([P("x1", "y1"), P("x2", "y2")], false), ctx.pin).includes(i);
  return handleWidget(ctx, [
    { sq: 1, locked: () => pin(0), get: () => P("x1", "y1"), drag: (p) => ctx.batch(() => {
      ctx.set("x1", rnd(p[0]));
      ctx.set("y1", rnd(p[1]));
    }) },
    { sq: 1, locked: () => pin(1), get: () => P("x2", "y2"), drag: (p) => ctx.batch(() => {
      ctx.set("x2", rnd(p[0]));
      ctx.set("y2", rnd(p[1]));
    }) }
  ]);
});

// src/widgets/poly.js
for (const tag of ["polygon", "polyline"]) Widgets.register((el) => el.tagName === tag, (ctx) => {
  const el = ctx.el, closed = tag === "polygon", g = mk("g"), A2 = (e, o) => {
    for (const k in o) e.setAttribute(k, o[k]);
  };
  ctx.overlay.append(g);
  const parse = () => {
    const n = (el.getAttribute("points") || "").match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [], p = [];
    for (let i = 0; i + 1 < n.length; i += 2) p.push([+n[i], +n[i + 1]]);
    return p;
  };
  let pts = parse(), items = [], hit, dead = false, mv0 = false, mv1 = false, pinned = /* @__PURE__ */ new Set();
  const S = selection(), min = closed ? 3 : 2;
  let uid = 0;
  const write = (own) => {
    const v = pts.map((p) => rnd(p[0]) + "," + rnd(p[1])).join(" "), r = own ? ctx.batch(() => ctx.set("points", v), own) : ctx.set("points", v);
    if (r === false) {
      pts = parse();
      build();
    } else if (el.getAttribute("points") !== v) pts.splice(0, pts.length, ...parse());
  };
  function drag(h, start, move, click) {
    h.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      h.setPointerCapture(e.pointerId);
      const p0 = ctx.toLocal(e);
      start(e);
      mv0 = mv1;
      mv1 = false;
      const mv = (ev) => {
        if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > 3) mv1 = true;
        move(ctx.toLocal(ev), p0);
        write();
        layout();
      };
      h.addEventListener("pointermove", mv);
      h.addEventListener("pointerup", () => {
        h.removeEventListener("pointermove", mv);
        if (!mv1 && click) click();
      }, { once: true });
    });
  }
  function del() {
    if (!S.size || !ctx.can("nodes.delete")) return false;
    const r = deletePoints(pts, S.items, min, pinned);
    if (!r) return false;
    pts = r;
    S.clear();
    write("del:" + ++uid);
    build();
    return true;
  }
  function insert(p) {
    let best = null;
    const n = pts.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = pts[i], b = pts[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
      const q = [a[0] + dx * t, a[1] + dy * t], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (!best || d < best.d) best = { d, i, q };
    }
    if (!best) return;
    pts.splice(best.i + 1, 0, best.q);
    S.pick("node", best.i + 1);
    write();
    build();
  }
  function build() {
    g.replaceChildren();
    items = [];
    hit = mk(tag, { fill: "none", stroke: "transparent", "stroke-width": 12, "vector-effect": "non-scaling-stroke", style: "pointer-events:stroke;cursor:" + (ctx.can("nodes.insert") ? "copy" : "move") });
    hit.addEventListener("dblclick", (e) => ctx.can("nodes.insert") && insert(ctx.toLocal(e)));
    hit.addEventListener("pointerdown", (e) => ctx.grab(e));
    g.append(hit);
    pinned = new Set(pinnedIdx(polyNodes(pts, closed), ctx.pin));
    S.keep("node", (i) => i < pts.length);
    pts.forEach((_, i) => {
      const h = mk("rect", { style: "pointer-events:all;cursor:move", fill: "var(--panel,#fff)", stroke: "var(--acc,#2f6fed)" });
      g.append(h);
      items.push({ h, get: () => pts[i], r: 5, n: 1, node: i, pin: pinned.has(i) });
      if (pinned.has(i)) {
        h.style.cursor = "not-allowed";
        h.setAttribute("fill", "#ddd");
        h.setAttribute("stroke", "#888");
        h.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          S.pick("node", i, e.shiftKey);
          layout();
        });
        return;
      }
      let refs = [], rel = () => {
      };
      drag(
        h,
        (e) => {
          rel = S.press("node", i, e.shiftKey);
          layout();
          refs = S.items.filter((j) => pts[j] && !pinned.has(j)).map((j) => [j, [...pts[j]]]);
        },
        (p, p0) => {
          if (refs.length === 1) pts[refs[0][0]] = p;
          else refs.forEach(([j, o]) => pts[j] = [o[0] + p[0] - p0[0], o[1] + p[1] - p0[1]]);
        },
        () => {
          rel();
          layout();
        }
      );
      h.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        if (mv0 || mv1) return;
        S.pick("node", i);
        del();
      });
    });
    layout();
  }
  function layout() {
    const M = ctx.matrix(), T = (p) => {
      const q = new DOMPoint(p[0], p[1]).matrixTransform(M);
      return [q.x, q.y];
    }, w = ctx.px(1.5);
    A2(hit, { points: pts.map((p) => p.join(",")).join(" "), transform: `matrix(${M.a} ${M.b} ${M.c} ${M.d} ${M.e} ${M.f})` });
    items.forEach((it) => {
      const [x, y] = T(it.get()), r = ctx.px(it.r);
      A2(it.h, it.n ? { x: x - r, y: y - r, width: 2 * r, height: 2 * r, "stroke-width": w } : { cx: x, cy: y, r, "stroke-width": w });
      const sl = S.has("node", it.node);
      if (it.pin) it.h.setAttribute("stroke", sl ? "var(--acc,#2f6fed)" : "#888");
      else it.h.setAttribute("fill", sl ? "var(--acc,#2f6fed)" : "var(--panel,#fff)");
    });
  }
  ctx.on("view", () => !dead && layout());
  ctx.on("key", (d) => {
    if (dead || d.handled || !S.size) return;
    if (d.key === "Escape") {
      S.clear();
      layout();
      d.handled = true;
    } else if (d.key === "Delete" || d.key === "Backspace") {
      del();
      d.handled = true;
    }
  });
  ctx.on("change", ({ el: e, src }) => {
    if (dead || e !== el || src === "widget") return;
    pts = parse();
    build();
  });
  build();
  return {
    update() {
      pts = parse();
      build();
    },
    destroy() {
      dead = true;
      g.remove();
    },
    deleteSelection: del,
    clearSelection() {
      S.clear();
      layout();
    },
    get selection() {
      return S.size ? { kind: "node", items: S.items } : null;
    }
  };
});

// src/widgets/fallback.js
Widgets.register(() => true, (ctx) => {
  const g = mk("g");
  ctx.overlay.append(g);
  function update() {
    g.replaceChildren();
    let b;
    try {
      b = ctx.el.getBBox();
    } catch {
      return;
    }
    const M = ctx.matrix(), pts = [[b.x, b.y], [b.x + b.width, b.y], [b.x + b.width, b.y + b.height], [b.x, b.y + b.height]].map(([x, y]) => {
      const p = new DOMPoint(x, y).matrixTransform(M);
      return [p.x, p.y];
    });
    g.append(mk("polygon", { points: pts.join(" "), fill: "none", stroke: "var(--acc,#2f6fed)", "stroke-width": ctx.px(1.5), "stroke-dasharray": ctx.px(5) + " " + ctx.px(3) }));
    pts.forEach(([x, y]) => g.append(mk("rect", { x: x - ctx.px(4), y: y - ctx.px(4), width: ctx.px(8), height: ctx.px(8), fill: "var(--panel,#fff)", stroke: "var(--acc,#2f6fed)", "stroke-width": ctx.px(1.5) })));
  }
  ctx.on("view", update);
  ctx.on("change", update);
  update();
  return { update, destroy() {
    g.remove();
  } };
}, { generic: true });

// src/tools.js
var Tools = {
  list: [],
  register(def) {
    const i = this.list.findIndex((d) => d.id === def.id);
    i < 0 ? this.list.push(def) : this.list[i] = def;
  },
  get(id) {
    return this.list.find((d) => d.id === id);
  }
};

// src/tools/circle.js
var circleFrom = (c, p, min = 0) => {
  const r = Math.hypot(p[0] - c[0], p[1] - c[1]);
  return r > min ? { cx: rnd(c[0]), cy: rnd(c[1]), r: rnd(r) } : null;
};
Tools.register({ id: "circle", label: "Circle", cursor: "crosshair", begin(t, p0) {
  const el = t.make("circle", { cx: rnd(p0[0]), cy: rnd(p0[1]), r: 0 }), put = (c) => {
    for (const k in c) el.setAttribute(k, c[k]);
  };
  return { move: (p) => {
    const c = circleFrom(p0, p);
    c && put(c);
  }, end: (p) => {
    const c = circleFrom(p0, p, t.px(2));
    if (!c) return null;
    put(c);
    return el;
  } };
} });

// src/tools/rect.js
var rectFrom = (a, b, min = 0) => {
  const w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
  return w > min && h > min ? { x: rnd(Math.min(a[0], b[0])), y: rnd(Math.min(a[1], b[1])), width: rnd(w), height: rnd(h) } : null;
};
Tools.register({ id: "rect", label: "Rectangle", cursor: "crosshair", begin(t, p0) {
  const el = t.make("rect", { x: rnd(p0[0]), y: rnd(p0[1]), width: 0, height: 0 }), put = (c) => {
    for (const k in c) el.setAttribute(k, c[k]);
  };
  return { move: (p) => {
    const c = rectFrom(p0, p);
    c && put(c);
  }, end: (p) => {
    const c = rectFrom(p0, p, t.px(2));
    if (!c) return null;
    put(c);
    return el;
  } };
} });

// src/tools/ellipse.js
var ellipseFrom = (a, b, min = 0) => {
  const w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
  return w > min && h > min ? { cx: rnd((a[0] + b[0]) / 2), cy: rnd((a[1] + b[1]) / 2), rx: rnd(w / 2), ry: rnd(h / 2) } : null;
};
Tools.register({ id: "ellipse", label: "Ellipse", cursor: "crosshair", begin(t, p0) {
  const el = t.make("ellipse", { cx: rnd(p0[0]), cy: rnd(p0[1]), rx: 0, ry: 0 }), put = (c) => {
    for (const k in c) el.setAttribute(k, c[k]);
  };
  return { move: (p) => {
    const c = ellipseFrom(p0, p);
    c && put(c);
  }, end: (p) => {
    const c = ellipseFrom(p0, p, t.px(2));
    if (!c) return null;
    put(c);
    return el;
  } };
} });

// src/tools/line.js
var lineFrom = (a, b, min = 0) => Math.hypot(b[0] - a[0], b[1] - a[1]) > min ? { x1: rnd(a[0]), y1: rnd(a[1]), x2: rnd(b[0]), y2: rnd(b[1]) } : null;
Tools.register({ id: "line", label: "Line", cursor: "crosshair", begin(t, p0) {
  const el = t.make("line", { x1: rnd(p0[0]), y1: rnd(p0[1]), x2: rnd(p0[0]), y2: rnd(p0[1]) }), put = (c) => {
    for (const k in c) el.setAttribute(k, c[k]);
  };
  return { move: (p) => {
    const c = lineFrom(p0, p);
    c && put(c);
  }, end: (p) => {
    const c = lineFrom(p0, p, t.px(2));
    if (!c) return null;
    put(c);
    return el;
  } };
} });

// src/tools/path.js
Tools.register({ id: "path", label: "Path", cursor: "crosshair", pen: true, tag: "path", blank: { d: "M0 0" }, real: (el) => ((el.getAttribute("d") || "").match(/[A-Za-z]/g) || []).length >= 2 });

// src/xform.js
var ownM = (el) => {
  let m = new DOMMatrix();
  const l = el.transform && el.transform.baseVal;
  if (l) for (let i = 0; i < l.numberOfItems; i++) {
    const t = l.getItem(i).matrix;
    m = m.multiply(new DOMMatrix([t.a, t.b, t.c, t.d, t.e, t.f]));
  }
  return m;
};
function fmtTransform({ a, b, c, d, e, f: f2 }) {
  const near2 = (x, y) => Math.abs(x - y) < 1e-7, r = (v) => +v.toFixed(6), q = (v) => +v.toFixed(3);
  const tr = Math.abs(e) > 1e-9 || Math.abs(f2) > 1e-9 ? `translate(${q(e)} ${q(f2)})` : "";
  let rest = "";
  if (near2(b, 0) && near2(c, 0)) {
    if (!(near2(a, 1) && near2(d, 1))) rest = `scale(${r(a)}${near2(a, d) ? "" : " " + r(d)})`;
  } else if (near2(a, d) && near2(b, -c) && near2(a * a + b * b, 1)) rest = `rotate(${+(Math.atan2(b, a) * 180 / Math.PI).toFixed(4)})`;
  else return `matrix(${[a, b, c, d].map(r).join(" ")} ${q(e)} ${q(f2)})`;
  return [tr, rest].filter(Boolean).join(" ") || null;
}

// src/glyph.js
var f = (n) => +n.toFixed(2);
var chev = (x, y, a, s = 2.6, d = 0.7) => {
  const p = (k) => `${f(x - s * Math.cos(a + k))} ${f(y - s * Math.sin(a + k))}`;
  return `M${p(d)}L${f(x)} ${f(y)}L${p(-d)}`;
};
var LIN = `M-4.6 0H4.6${chev(4.6, 0, 0)}${chev(-4.6, 0, Math.PI)}`;
var R = 5.6;
var CX = -3.8;
var A = 1.2;
var ex = Math.cos(A) * R + CX;
var ey = Math.sin(A) * R;
var ROT = `M${f(ex)} ${f(-ey)}A${R} ${R} 0 0 1 ${f(ex)} ${f(ey)}${chev(ex, ey, A + Math.PI / 2, 2.3, 0.6)}${chev(ex, -ey, -A - Math.PI / 2, 2.3, 0.6)}`;

// src/widgets/transform.js
var ACC = "var(--acc,#2f6fed)";
var PANEL = "var(--panel,#fff)";
var r6 = (v) => +v.toFixed(6);
var cursor = (a) => ["ew", "nwse", "ns", "nesw"][Math.round((a % Math.PI + Math.PI) % Math.PI / (Math.PI / 4)) % 4] + "-resize";
var nz = (s) => Math.abs(s) < 1e-3 ? s < 0 ? -1e-3 : 1e-3 : s;
var CAP = { sc: "transform.scale", sx: "transform.scale", sy: "transform.scale", rot: "transform.rotate", kx: "transform.skew", ky: "transform.skew" };
function transformLayer(ctx, kind) {
  const el = ctx.el, g = mk("g"), A2 = (e, o) => {
    for (const k in o) e.setAttribute(k, o[k]);
  }, ol = mk("polygon", { fill: "none", stroke: ACC });
  g.append(ol);
  ctx.overlay.append(g);
  let dead = false, cap = null;
  const frame = (e, hx, hy) => {
    const inv2 = ctx.matrix().inverse(), loc = (ev) => {
      const o = ctx.toOverlay(ev), q = new DOMPoint(o[0], o[1]).matrixTransform(inv2);
      return [q.x, q.y];
    }, p0 = loc(e);
    return { b: ctx.bbox(), t0: el.getAttribute("transform") || "", dirty: false, at: (ev) => {
      const p = loc(ev);
      return [hx + p[0] - p0[0], hy + p[1] - p0[1]];
    } };
  };
  const put = (S, pre, post) => {
    ctx.set("transform", [pre, S.t0, post].filter(Boolean).join(" "), "widget", cap);
    S.dirty = true;
  };
  const begin = {
    sc: (ix, iy) => (e) => {
      const b = ctx.bbox(), hx = b.x + b.w * ix, hy = b.y + b.h * iy, ax = b.x + b.w * (1 - ix), ay = b.y + b.h * (1 - iy), vx = hx - ax, vy = hy - ay, L = vx * vx + vy * vy, S = frame(e, hx, hy);
      return { S, move: (ev) => {
        if (L < 1e-12) return;
        const p = S.at(ev), s = nz(((p[0] - ax) * vx + (p[1] - ay) * vy) / L);
        put(S, "", `translate(${rnd(ax)} ${rnd(ay)}) scale(${r6(s)}) translate(${rnd(-ax)} ${rnd(-ay)})`);
      } };
    },
    sx: (ix, iy) => (e) => {
      const b = ctx.bbox(), hx = b.x + b.w * ix, ax = b.x + b.w * (1 - ix), S = frame(e, hx, b.y + b.h / 2);
      return { S, move: (ev) => {
        if (Math.abs(hx - ax) < 1e-9) return;
        const s = nz((S.at(ev)[0] - ax) / (hx - ax));
        put(S, "", `translate(${rnd(ax)} 0) scale(${r6(s)} 1) translate(${rnd(-ax)} 0)`);
      } };
    },
    sy: (ix, iy) => (e) => {
      const b = ctx.bbox(), hy = b.y + b.h * iy, ay = b.y + b.h * (1 - iy), S = frame(e, b.x + b.w / 2, hy);
      return { S, move: (ev) => {
        if (Math.abs(hy - ay) < 1e-9) return;
        const s = nz((S.at(ev)[1] - ay) / (hy - ay));
        put(S, "", `translate(0 ${rnd(ay)}) scale(1 ${r6(s)}) translate(0 ${rnd(-ay)})`);
      } };
    },
    rot: () => (e) => {
      const M0 = ownM(el), Pinv = ctx.matrix().multiply(M0.inverse()).inverse(), b = ctx.bbox(), c = new DOMPoint(b.x + b.w / 2, b.y + b.h / 2).matrixTransform(M0), par = (ev) => {
        const o = ctx.toOverlay(ev), q = new DOMPoint(o[0], o[1]).matrixTransform(Pinv);
        return Math.atan2(q.y - c.y, q.x - c.x);
      }, a0 = par(e), S = { t0: el.getAttribute("transform") || "", dirty: false };
      return { S, move: (ev) => {
        let d = (par(ev) - a0) * 180 / Math.PI;
        if (ev.shiftKey) d = Math.round(d / 15) * 15;
        put(S, `rotate(${+d.toFixed(3)} ${rnd(c.x)} ${rnd(c.y)})`, "");
      } };
    },
    kx: (ix, iy) => (e) => {
      const b = ctx.bbox(), hy = b.y + b.h * iy, ay = b.y + b.h * (1 - iy), d = hy - ay, cx = b.x + b.w / 2, S = frame(e, cx, hy);
      return { S, move: (ev) => {
        if (Math.abs(d) < 1e-9) return;
        const k = (S.at(ev)[0] - cx) / d;
        put(S, "", `matrix(1 0 ${r6(k)} 1 ${rnd(-k * ay)} 0)`);
      } };
    },
    ky: (ix, iy) => (e) => {
      const b = ctx.bbox(), hx = b.x + b.w * ix, ax = b.x + b.w * (1 - ix), d = hx - ax, cy = b.y + b.h / 2, S = frame(e, hx, cy);
      return { S, move: (ev) => {
        if (Math.abs(d) < 1e-9) return;
        const k = (S.at(ev)[1] - cy) / d;
        put(S, "", `matrix(1 ${r6(k)} 0 1 0 ${rnd(-k * ax)})`);
      } };
    }
  };
  const specs = [];
  for (const iy of [0, 0.5, 1]) for (const ix of [0, 0.5, 1]) {
    if (ix === 0.5 && iy === 0.5) continue;
    const corner = ix !== 0.5 && iy !== 0.5, vert = ix !== 0.5 && iy === 0.5;
    const role = kind === "scale" ? corner ? "sc" : vert ? "sx" : "sy" : corner ? "rot" : vert ? "ky" : "kx";
    const h = mk("g", { style: "pointer-events:all" });
    h.append(mk("circle", { r: 8, fill: PANEL, stroke: ACC, "stroke-width": 1.2 }), mk("path", { d: role === "rot" ? ROT : LIN, fill: "none", stroke: ACC, "stroke-width": 1.4, "stroke-linecap": "round", "stroke-linejoin": "round" }));
    g.append(h);
    specs.push({ ix, iy, role, g: h });
    h.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      h.setPointerCapture(e.pointerId);
      cap = CAP[role];
      const G = begin[role](ix, iy)(e);
      if (!G) return;
      const mv = (ev) => G.move(ev);
      h.addEventListener("pointermove", mv);
      h.addEventListener("pointerup", () => {
        h.removeEventListener("pointermove", mv);
        if (G.S.dirty) ctx.set("transform", fmtTransform(ownM(el)), "widget", cap);
      }, { once: true });
    });
  }
  function layout() {
    const b = ctx.bbox();
    g.style.display = b ? "" : "none";
    if (!b) return;
    const M = ctx.matrix(), T = (x, y) => {
      const q = new DOMPoint(x, y).matrixTransform(M);
      return [q.x, q.y];
    }, C = T(b.x + b.w / 2, b.y + b.h / 2);
    A2(ol, { points: [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map((p) => T(p[0], p[1])).join(" "), "stroke-width": ctx.px(1.5), "stroke-dasharray": ctx.px(5) + " " + ctx.px(3) });
    specs.forEach((s) => {
      let [x, y] = T(b.x + b.w * s.ix, b.y + b.h * s.iy);
      const dx = s.ix - 0.5, dy = s.iy - 0.5, min = ctx.px(dx && dy ? 24 : 20);
      let vx = x - C[0], vy = y - C[1], d = Math.hypot(vx, vy);
      if (d < min) {
        if (d < 1e-6) {
          vx = M.a * dx + M.c * dy;
          vy = M.b * dx + M.d * dy;
          d = Math.hypot(vx, vy) || 1;
        }
        x = C[0] + vx / d * min;
        y = C[1] + vy / d * min;
      }
      const v = s.role === "sc" || s.role === "rot" ? [x - C[0], y - C[1]] : s.role === "sx" || s.role === "kx" ? [M.a, M.b] : [M.c, M.d], a = Math.atan2(v[1], v[0]);
      A2(s.g, { transform: `translate(${x} ${y}) rotate(${a * 180 / Math.PI}) scale(${ctx.px(1)})` });
      s.g.style.cursor = s.role === "rot" ? "grab" : cursor(a);
      const e = 1e-9, live2 = { sc: b.w > e || b.h > e, sx: b.w > e, sy: b.h > e, rot: true, kx: b.h > e, ky: b.w > e }[s.role];
      s.g.style.display = live2 && ctx.can(CAP[s.role]) ? "" : "none";
    });
  }
  ctx.on("view", () => !dead && layout());
  ctx.on("change", () => !dead && layout());
  layout();
  return { update: layout, destroy() {
    dead = true;
    g.remove();
  } };
}

// src/widgets/halo.js
var GEO2 = { path: ["d"], polygon: ["points"], polyline: ["points"], line: ["x1", "y1", "x2", "y2"], rect: ["x", "y", "width", "height", "rx", "ry"], circle: ["cx", "cy", "r"], ellipse: ["cx", "cy", "rx", "ry"] };
function haloWidget(ctx) {
  const el = ctx.el, geo = GEO2[el.tagName];
  if (!geo) return null;
  const h = mk(el.tagName, { "data-sable": "halo", fill: "none", stroke: "transparent", "stroke-width": 12, "vector-effect": "non-scaling-stroke", style: "pointer-events:stroke;cursor:move" });
  ctx.overlay.append(h);
  let dead = false;
  h.addEventListener("pointerdown", (e) => ctx.grab(e));
  function layout() {
    geo.forEach((a) => {
      const v = el.getAttribute(a);
      v === null ? h.removeAttribute(a) : h.setAttribute(a, v);
    });
    const M = ctx.matrix();
    h.setAttribute("transform", `matrix(${M.a} ${M.b} ${M.c} ${M.d} ${M.e} ${M.f})`);
  }
  ctx.on("view", () => !dead && layout());
  ctx.on("change", () => !dead && layout());
  layout();
  return { update: layout, destroy() {
    dead = true;
    h.remove();
  } };
}

// src/move.js
function mover(ctx) {
  const el = ctx.el, t = el.tagName;
  const pairs = { rect: [["x", "y"]], circle: [["cx", "cy"]], ellipse: [["cx", "cy"]], line: [["x1", "y1"], ["x2", "y2"]] }[t];
  if (pairs) {
    const s = pairs.map((p) => p.map((a) => num(el, a)));
    return (dx, dy) => pairs.forEach((p, i) => {
      ctx.set(p[0], rnd(s[i][0] + dx));
      ctx.set(p[1], rnd(s[i][1] + dy));
    });
  }
  if (t === "polygon" || t === "polyline") {
    const n = (el.getAttribute("points") || "").match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [], p = [];
    for (let i = 0; i + 1 < n.length; i += 2) p.push([+n[i], +n[i + 1]]);
    return (dx, dy) => ctx.set("points", p.map((q) => rnd(q[0] + dx) + "," + rnd(q[1] + dy)).join(" "));
  }
  if (t === "path") {
    const segs = parsePath(el.getAttribute("d") || "");
    return (dx, dy) => ctx.set("d", serPath(segs.map((s) => ({ ...s, pts: s.pts.map((q) => [q[0] + dx, q[1] + dy]) }))));
  }
  return null;
}

// src/body.js
function bodyGrab(ctx, { cycle, moved: moved2, done }) {
  const el = ctx.el;
  let busy = false, off = null;
  function grab(e, { fresh = false, click } = {}) {
    if (e.button !== 0 || busy) return;
    const id = e.pointerId, thr = e.pointerType === "touch" ? 8 : 3, x0 = e.clientX, y0 = e.clientY, t0 = el.getAttribute("transform") || "", l0 = ctx.toLocal(e), p0 = ctx.toParent(e);
    const CAP2 = "transform.move", can = ctx.can(CAP2), put = (a, v) => ctx.set(a, v, "widget", CAP2), mv = can ? mover({ el, set: put }) : null;
    let go = false;
    busy = true;
    const move = (ev) => {
      if (ev.pointerId !== id) return;
      if (!go) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) <= thr) return;
        go = true;
      }
      if (!can) return;
      if (mv) {
        const p = ctx.toLocal(ev);
        ctx.batch(() => mv(p[0] - l0[0], p[1] - l0[1]));
      } else {
        const p = ctx.toParent(ev);
        put("transform", `translate(${rnd(p[0] - p0[0])} ${rnd(p[1] - p0[1])})` + (t0 ? " " + t0 : ""));
      }
      moved2();
    };
    const stop = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", end);
      removeEventListener("pointercancel", end);
      busy = false;
      off = null;
    };
    function end(ev) {
      if (ev.pointerId !== id) return;
      stop();
      if (go && can && !mv) put("transform", fmtTransform(ownM(el)));
      done();
      if (go || fresh || ev.type !== "pointerup") return;
      click ? click() : cycle();
    }
    addEventListener("pointermove", move);
    addEventListener("pointerup", end);
    addEventListener("pointercancel", end);
    off = stop;
  }
  return { grab, get busy() {
    return busy;
  }, destroy() {
    off && off();
  } };
}

// src/menu.js
var placeMenu = (x, y, w, h, vw, vh, pad = 4) => ({ left: x + w + pad > vw ? Math.max(pad, x - w) : x, top: y + h + pad > vh ? Math.max(pad, vh - h - pad) : y });
var placeSub = (r, w, h, vw, vh, pad = 4) => ({ left: Math.max(pad, r.right + w + pad > vw ? r.left - w : r.right), top: r.top + h + pad > vh ? Math.max(pad, vh - h - pad) : r.top });
var CSS = "position:fixed;left:0;top:0;visibility:hidden;z-index:2147483000;min-width:150px;padding:4px 0;margin:0;background:var(--panel,#fff);color:#222;border:1px solid #ccc;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.22);font:13px/1.4 system-ui,sans-serif;user-select:none;-webkit-user-select:none";
var live = null;
function openMenu(items, x, y, onClose) {
  live && live.close();
  const doc = document, panels = [];
  let closed = false;
  const lit = (row, on) => {
    row.el.style.background = on ? "var(--acc,#2f6fed)" : "";
    row.el.style.color = on ? "#fff" : "";
  };
  const focus = (p, i) => {
    if (p.sel >= 0) lit(p.rows[p.sel], false);
    p.sel = i;
    if (i >= 0) lit(p.rows[i], true);
  };
  const trim = (n) => {
    while (panels.length > n) panels.pop().el.remove();
  };
  function build(list, at) {
    const el = doc.createElement("div");
    el.setAttribute("role", "menu");
    el.style.cssText = CSS;
    const p = { el, rows: [], sel: -1 };
    list.forEach((it) => {
      if (it.sep) {
        const s = doc.createElement("div");
        s.setAttribute("role", "separator");
        s.style.cssText = "height:1px;margin:4px 0;background:#ddd";
        el.append(s);
        return;
      }
      const r = doc.createElement("div"), ck = doc.createElement("span"), lb = doc.createElement("span");
      r.setAttribute("role", "menuitem");
      if (it.disabled) r.setAttribute("aria-disabled", "true");
      r.style.cssText = "display:flex;align-items:center;gap:8px;padding:4px 14px 4px 8px;cursor:default;white-space:nowrap" + (it.disabled ? ";opacity:.45" : "");
      ck.style.cssText = "width:14px;text-align:center";
      ck.textContent = it.checked ? "\u2713" : "";
      lb.style.flex = "1";
      lb.textContent = it.label;
      r.append(ck, lb);
      if (it.submenu) {
        const a = doc.createElement("span");
        a.textContent = "\u25B8";
        a.style.marginLeft = "12px";
        r.append(a);
        r.setAttribute("aria-haspopup", "true");
      }
      const row = { el: r, it };
      p.rows.push(row);
      el.append(r);
      r.addEventListener("mouseenter", () => enter(p, row));
      r.addEventListener("click", (e) => {
        e.stopPropagation();
        activate(p, row);
      });
    });
    doc.body.append(el);
    const b = el.getBoundingClientRect(), q = at(b.width, b.height, doc.documentElement.clientWidth, doc.documentElement.clientHeight);
    el.style.left = q.left + "px";
    el.style.top = q.top + "px";
    el.style.visibility = "";
    panels.push(p);
    return p;
  }
  function openSub(p, row, first) {
    trim(panels.indexOf(p) + 1);
    const l = row.it.submenu, list = typeof l === "function" ? l() : l, r = row.el.getBoundingClientRect();
    const sp = build(list, (w, h, vw, vh) => placeSub(r, w, h, vw, vh));
    if (first) {
      const i = sp.rows.findIndex((q) => !q.it.disabled);
      i >= 0 && focus(sp, i);
    }
  }
  function enter(p, row) {
    trim(panels.indexOf(p) + 1);
    if (row.it.disabled) {
      focus(p, -1);
      return;
    }
    focus(p, p.rows.indexOf(row));
    if (row.it.submenu) openSub(p, row, false);
  }
  function activate(p, row, viaKey) {
    if (row.it.disabled) return;
    if (row.it.submenu) {
      openSub(p, row, viaKey);
      return;
    }
    close();
    row.it.action && row.it.action();
  }
  const key = (e) => {
    const p = panels[panels.length - 1], k = e.key, r = p.rows[p.sel];
    const move = (d) => {
      const en = p.rows.map((_, i) => i).filter((i) => !p.rows[i].it.disabled);
      if (!en.length) return;
      const at = en.indexOf(p.sel);
      focus(p, en[at < 0 ? d > 0 ? 0 : en.length - 1 : (at + d + en.length) % en.length]);
    };
    if (k === "ArrowDown") move(1);
    else if (k === "ArrowUp") move(-1);
    else if (k === "ArrowRight") {
      if (r && r.it.submenu) openSub(p, r, true);
    } else if (k === "Enter" || k === " ") {
      if (r) activate(p, r, true);
    } else if (k === "ArrowLeft") {
      if (panels.length < 2) return;
      trim(panels.length - 1);
    } else if (k === "Escape") {
      panels.length > 1 ? trim(panels.length - 1) : close();
    } else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const down = (e) => {
    if (!panels.some((p) => p.el.contains(e.target))) close();
  };
  const ctx = (e) => {
    if (panels.some((p) => p.el.contains(e.target))) e.preventDefault();
  };
  doc.addEventListener("keydown", key, true);
  doc.addEventListener("pointerdown", down, true);
  doc.addEventListener("contextmenu", ctx, true);
  addEventListener("blur", close);
  addEventListener("resize", close);
  addEventListener("scroll", close, true);
  function close() {
    if (closed) return;
    closed = true;
    trim(0);
    doc.removeEventListener("keydown", key, true);
    doc.removeEventListener("pointerdown", down, true);
    doc.removeEventListener("contextmenu", ctx, true);
    removeEventListener("blur", close);
    removeEventListener("resize", close);
    removeEventListener("scroll", close, true);
    if (live === ctl) live = null;
    onClose && onClose();
  }
  const ctl = live = { close };
  build(items, (w, h, vw, vh) => placeMenu(x, y, w, h, vw, vh));
  return ctl;
}

// src/attach.js
var MODES = ["scale", "rotate", "edit"];
function attach(svg, opts = {}) {
  const PRIM = opts.selector || "path,rect,circle,ellipse,line,polyline,polygon,text", root = opts.root || svg;
  let ov = opts.overlay;
  if (!ov) {
    ov = mk("g", { style: "pointer-events:none" });
    svg.append(ov);
  }
  const hs = {}, on = (e, f2) => {
    (hs[e] ??= []).push(f2);
  }, emit = (e, d) => [...hs[e] || []].forEach((f2) => f2(d));
  if (opts.onSelect) on("select", opts.onSelect);
  if (opts.onCreate) on("create", (d) => opts.onCreate(d.el));
  if (opts.onChange) on("change", (d) => opts.onChange(d.el, d.attr, d.src));
  if (opts.onDenied) on("denied", (d) => opts.onDenied(d.el, d));
  let P = compilePolicy(opts.policy, { root }), lastDeny = "";
  if (P) P.validate(root);
  const perms = (el) => P ? P.resolve(el) : OPEN, toolOk = (id) => !P || P.toolOk(id);
  let sel = null, layer = null, halo = null, body = null, subs = [], menuOffs = [], start = MODES.includes(opts.mode) ? opts.mode : "scale", pref = start === "edit" ? "scale" : start, editing = start === "edit";
  let tool = "pointer", oneShot = false, gesture = null, swallow = false, menuCtl = null;
  const cycLog = [];
  const ONCE = false;
  let penSeg = "auto", penEl = null, penPub = false;
  const penOn = () => !!Tools.get(tool)?.pen;
  const undoS = [], redoS = [];
  let gid = 0;
  const record = (el, attr, old, nw, src, own) => {
    const key = own || src + ":" + (src === "widget" ? gid : attr), now = Date.now(), last = undoS.at(-1);
    if (last && last.key === key && (src === "widget" || own || now - last.t < 800)) {
      const it = last.items.find((i) => i.el === el && i.attr === attr);
      it ? it.nw = nw : last.items.push({ el, attr, old, nw });
      last.t = now;
    } else undoS.push({ key, t: now, items: [{ el, attr, old, nw }] });
    redoS.length = 0;
    emit("history");
  };
  let pending = null, bid = 0;
  const bbox = (el) => {
    try {
      const b = el.getBBox();
      return [b.x, b.y, b.x + b.width, b.y + b.height];
    } catch {
      return null;
    }
  };
  const setAttr = (el, attr, v, src = "app", cap, force) => {
    const c = { el, attr, nw: v === null ? null : String(v), src, cap, force };
    if (pending) {
      pending.push(c);
      return true;
    }
    return flush([c]);
  };
  const batch = (fn, own) => {
    const q = pending = [];
    q.own = own;
    try {
      fn();
    } finally {
      pending = null;
    }
    return flush(q);
  };
  function flush(q) {
    const by = /* @__PURE__ */ new Map();
    let ok = true;
    for (const c of q) (by.get(c.el) || by.set(c.el, []).get(c.el)).push(c);
    for (const [el, cs] of by) {
      const last = new Map(cs.map((c) => [c.attr, c])), gate = cs.filter((c) => !c.force);
      const vals = new Map([...last].map(([a, c]) => [a, c.nw]));
      if (P && gate.length) {
        const r = checkWrites(perms(el), el.tagName, (a) => el.getAttribute(a), gate.map((c) => ({ attr: c.attr, nw: c.nw, hint: c.cap })), { bbox: () => bbox(el) });
        if (!r.ok) {
          const c = gate.find((g) => g.attr === r.attr) || gate[0], k = gid + ":" + r.cap;
          ok = false;
          if (c.src !== "widget" || k !== lastDeny) {
            lastDeny = k;
            emit("denied", { el, attr: r.attr, cap: r.cap, reason: r.reason, src: c.src });
          }
          continue;
        }
        r.values.forEach((v, a) => {
          if (!last.get(a).force) vals.set(a, v);
        });
      }
      const done = [];
      for (const [attr, nw] of vals) {
        const old = el.getAttribute(attr);
        if (old === nw) continue;
        nw === null ? el.removeAttribute(attr) : el.setAttribute(attr, nw);
        record(el, attr, old, nw, last.get(attr).src, q.own);
        done.push([attr, last.get(attr).src]);
      }
      done.forEach(([attr, src]) => emit("change", { el, attr, src }));
    }
    return ok;
  }
  const stepAdd = (i, dir) => {
    if (dir > 0) {
      i.parent.insertBefore(i.el, i.next && i.next.parentNode === i.parent ? i.next : null);
      emit("create", { el: i.el, src: "history" });
    } else {
      if (sel === i.el) select(null);
      i.el.remove();
      emit("remove", { el: i.el, src: "history" });
    }
  };
  const step = (from, to, dir) => {
    const g = from.pop();
    if (!g) return;
    (dir > 0 ? g.items : [...g.items].reverse()).forEach((i) => {
      if (i.add) return stepAdd(i, dir);
      const v = dir > 0 ? i.nw : i.old;
      v === null ? i.el.removeAttribute(i.attr) : i.el.setAttribute(i.attr, v);
      emit("change", { el: i.el, attr: i.attr, src: "history" });
    });
    to.push(g);
    emit("history");
  };
  const undo = () => step(undoS, redoS, -1), redo = () => step(redoS, undoS, 1);
  const clearHistory = () => {
    undoS.length = redoS.length = 0;
    emit("history");
  };
  const onDown = () => {
    gid++;
  };
  const onKey = (e) => {
    const t = document.activeElement;
    if (/INPUT|TEXTAREA|SELECT/.test(t?.tagName) || t?.isContentEditable) return;
    if (!(e.ctrlKey || e.metaKey || e.altKey) && /^(Escape|Delete|Backspace)$/.test(e.key)) {
      const d = { key: e.key, event: e, handled: false };
      emit("key", d);
      if (d.handled) {
        e.preventDefault();
        return;
      }
    }
    if (e.key === "Enter" && !(e.ctrlKey || e.metaKey || e.altKey) && penOn() && !gesture) {
      e.preventDefault();
      penFinish();
      return;
    }
    if (e.key === "Escape") {
      if (gesture) return;
      if (tool !== "pointer") {
        setTool("pointer");
        return;
      }
      if (sel && cur() === "edit" && xmodes(sel).length) {
        editing = false;
        build();
        emit("mode", cur());
        return;
      }
      if (sel) select(null);
      return;
    }
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === "z") {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if (k === "y") {
      e.preventDefault();
      redo();
    }
  };
  svg.addEventListener("pointerdown", onDown, true);
  if (opts.keys !== false) addEventListener("keydown", onKey);
  const scale = () => {
    const m = ov.getScreenCTM();
    return m ? Math.hypot(m.a, m.b) || 1 : 1;
  };
  const dm = (m) => new DOMMatrix([m.a, m.b, m.c, m.d, m.e, m.f]), matrixFor = (el) => dm(ov.getCTM().inverse().multiply(el.getCTM()));
  const modesFor = (el) => {
    const e = Widgets.find(el), p = perms(el);
    return MODES.filter((m) => modeOk(p, m) && (m !== "edit" || e && !e.generic));
  };
  const xmodes = (el) => modesFor(el).filter((m) => m !== "edit"), canEdit = (el) => modesFor(el).includes("edit");
  const cur = () => {
    const t = xmodes(sel);
    if (canEdit(sel) && (editing || !t.length)) return "edit";
    return t.includes(pref) ? pref : t[0];
  };
  const unsub = () => {
    menuOffs.forEach((f2) => f2());
    menuOffs = [];
    subs.forEach(([e, f2]) => {
      const a = hs[e], i = a ? a.indexOf(f2) : -1;
      if (i >= 0) a.splice(i, 1);
    });
    subs = [];
  };
  const teardown = () => {
    layer?.destroy();
    halo?.destroy();
    layer = halo = null;
    unsub();
    ov.replaceChildren();
  };
  let ctx = null;
  function build() {
    teardown();
    const m = cur();
    if (!m) return;
    halo = m === "edit" && /^(path|polygon|polyline)$/.test(sel.tagName) ? null : haloWidget(ctx);
    layer = m === "edit" ? Widgets.find(sel).factory(ctx) : transformLayer(ctx, m);
  }
  function select(el) {
    if (el === sel || el && !perms(el).selectable) return;
    body?.destroy();
    body = null;
    teardown();
    sel = el;
    ctx = null;
    pref = start === "edit" ? "scale" : start;
    editing = start === "edit" || penOn();
    if (tool === "pointer") svg.style.cursor = cursorWas;
    if (el) {
      const toOverlay = (e) => {
        const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(ov.getScreenCTM().inverse());
        return [q.x, q.y];
      };
      ctx = {
        el,
        overlay: ov,
        on: (e, f2) => {
          on(e, f2);
          subs.push([e, f2]);
        },
        matrix: () => matrixFor(el),
        px: (n) => n / scale(),
        toOverlay,
        toLocal(e) {
          const o = toOverlay(e), q = new DOMPoint(o[0], o[1]).matrixTransform(matrixFor(el).inverse());
          return [q.x, q.y];
        },
        /* pointer in the parent's coordinate system: what the element's own `transform` is relative to */
        toParent(e) {
          const o = toOverlay(e), q = new DOMPoint(o[0], o[1]).matrixTransform(matrixFor(el).multiply(ownM(el).inverse()).inverse());
          return [q.x, q.y];
        },
        bbox() {
          try {
            const b = el.getBBox();
            return { x: b.x, y: b.y, w: b.width, h: b.height };
          } catch {
            return null;
          }
        },
        set(a, v, src = "widget", cap) {
          return setAttr(el, a, v, src, cap);
        },
        // false = refused by the policy
        menu: (f2) => {
          menuOffs.push(api.addMenu(f2));
        },
        // the shape's editor adds items to the right-click menu while it is selected: f({x,y,target,editor}) => [items]
        batch,
        // batch(fn): the writes made inside fn are checked and applied together
        get penOn() {
          return penOn();
        },
        get penSeg() {
          return penSeg;
        },
        // a pen tool is armed / what kind of segment its next node adds
        undo,
        // for a pen gesture cancelled halfway: its writes are the newest undo step
        /* a point the pen is about to add, brought onto the policy's grid and inside its walls: the policy leaves added nodes alone (it judges edits
           to existing ones), and the pen is nothing but added nodes */
        fit(q) {
          const p = perms(el);
          let r = q;
          if (p.snap) r = [Math.round(r[0] / p.snap[0]) * p.snap[0], Math.round(r[1] / p.snap[1]) * p.snap[1]];
          if (p.bounds) {
            const B = p.bounds, M = ownM(el), w = new DOMPoint(r[0], r[1]).matrixTransform(M), c = new DOMPoint(Math.min(B[2], Math.max(B[0], w.x)), Math.min(B[3], Math.max(B[1], w.y))).matrixTransform(M.inverse());
            r = [c.x, c.y];
          }
          return r;
        },
        deny: (cap, reason) => emit("denied", { el, attr: "d", cap, reason, src: "widget" }),
        // a refusal that isn't a write (the pen won't continue a pinned shape)
        penFinish: () => penFinish(),
        // the pen's "this path is done": deselect its node, drop it if it never got a segment
        can: (c) => perms(el).can(c),
        get pin() {
          return perms(el).pin;
        },
        // what the policy allows this shape / which nodes it pins
        /* a press on this shape that a widget's own overlay element caught: drag = move, click = next mode (see body.js) */
        grab(e, o) {
          if (!ctxClick(e)) body.grab(e, o);
        }
      };
      body = bodyGrab(ctx, {
        cycle: () => api.cycleMode(),
        moved: () => layer && layer.update && layer.update(),
        done: () => {
          swallow = true;
          setTimeout(() => {
            swallow = false;
          });
        }
      });
      build();
    }
    emit("select", el);
  }
  const pickAt = (e) => {
    const t = e.target.closest?.(PRIM);
    return t && root.contains(t) && perms(t).selectable ? t : null;
  };
  const onPress = (e) => {
    if (e.button !== 0 || ctxClick(e) || tool !== "pointer" || gesture || ov.contains(e.target)) return;
    const t = pickAt(e);
    if (!t) return;
    if (t === sel) body.grab(e);
    else if (opts.pick !== false) {
      select(t);
      body.grab(e, { fresh: true });
    }
  };
  const onClick = (e) => {
    if (swallow) {
      swallow = false;
      return;
    }
    if (ov.contains(e.target) || ctxClick(e)) return;
    select(pickAt(e));
  };
  svg.addEventListener("pointerdown", onPress);
  if (opts.pick !== false) svg.addEventListener("click", onClick);
  const onHover = (e) => {
    if (tool !== "pointer" || gesture || body && body.busy) return;
    svg.style.cursor = sel && !ov.contains(e.target) && pickAt(e) === sel && perms(sel).can("transform.move") ? "move" : cursorWas;
  };
  svg.addEventListener("pointermove", onHover);
  const editTarget = (e) => ov.contains(e.target) ? e.target.getAttribute?.("data-sable") === "halo" ? sel : null : pickAt(e);
  const editAt = (t) => {
    if (t !== sel && opts.pick === false) return false;
    if (t !== sel) select(t);
    return api.edit();
  };
  const onDbl = (e) => {
    if (e.button !== 0 || tool !== "pointer" || gesture) return;
    const t = editTarget(e);
    if (!t) return;
    const now = performance.now(), c = cycLog.find((q) => now - q.t < 600);
    if (c) pref = c.from;
    cycLog.length = 0;
    editAt(t);
  };
  svg.addEventListener("dblclick", onDbl);
  const LONG = 450;
  let lp = null, lpDone = -1e9;
  const lpStop = () => {
    if (!lp) return;
    clearTimeout(lp.timer);
    removeEventListener("pointermove", lp.move);
    removeEventListener("pointerup", lp.end);
    removeEventListener("pointercancel", lp.end);
    lp = null;
  };
  const onLong = (e) => {
    lpStop();
    if (e.pointerType === "mouse" || e.button !== 0 || tool !== "pointer" || gesture) return;
    const t = editTarget(e);
    if (!t) return;
    const id = e.pointerId, x0 = e.clientX, y0 = e.clientY;
    const fire = () => {
      lpStop();
      lpDone = performance.now();
      editAt(t);
    };
    lp = {
      timer: setTimeout(fire, LONG),
      fire,
      move: (ev) => {
        if (ev.pointerId === id && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) lpStop();
      },
      end: (ev) => {
        if (ev.pointerId === id) lpStop();
      }
    };
    addEventListener("pointermove", lp.move);
    addEventListener("pointerup", lp.end);
    addEventListener("pointercancel", lp.end);
  };
  svg.addEventListener("pointerdown", onLong);
  const isMac = () => /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || "");
  const ctxClick = (e) => e.button === 2 || e.button === 0 && e.ctrlKey && isMac();
  const cursorWas = svg.style.cursor;
  const hostEl = () => {
    const c = opts.createIn;
    return (typeof c === "string" ? svg.querySelector(c) : c) || root;
  };
  const shapeAttrs = () => ({ fill: "#d6eaf8", stroke: "#2874a6", "stroke-width": 2, ...opts.shapeAttrs });
  function setTool(id, once = false) {
    if (gesture) return;
    const T = Tools.get(id);
    if (id !== "pointer" && (!T || !toolOk(id))) return;
    once = ONCE && once && id !== "pointer";
    if (id === tool && once === oneShot) return;
    const wasPen = penOn();
    if (wasPen && !(T && T.pen)) penCleanup();
    tool = id;
    oneShot = once;
    svg.style.cursor = T ? T.cursor || "crosshair" : cursorWas;
    if (T && T.pen) {
      if (sel && sel.tagName !== T.tag) select(null);
      if (sel) {
        const was = cur();
        editing = true;
        if (cur() !== was) {
          build();
          emit("mode", cur());
        }
      }
    } else if (T) select(null);
    else if (wasPen && sel) {
      editing = false;
      pref = start === "edit" ? "scale" : start;
      build();
      emit("mode", cur());
    }
    emit("tool", id);
  }
  const realOf = (el) => {
    const T = Tools.list.find((t) => t.pen && t.tag === el.tagName);
    return !T || !T.real || T.real(el);
  };
  const forget = (el) => {
    for (const st of [undoS, redoS]) for (let i = st.length; i--; ) {
      const g = st[i];
      g.items = g.items.filter((it) => it.el !== el);
      if (!g.items.length) st.splice(i, 1);
    }
  };
  function penCleanup() {
    const el = penEl;
    penEl = null;
    if (!el || !el.isConnected || realOf(el)) return;
    if (sel === el) select(null);
    el.remove();
    forget(el);
    emit("history");
    if (penPub) emit("remove", { el, src: "tool" });
  }
  function penFinish() {
    if (!penOn()) return;
    layer && layer.pen && layer.pen.clear();
    penCleanup();
  }
  const penAfter = () => {
    if (penEl && !penPub && realOf(penEl)) {
      penPub = true;
      emit("create", { el: penEl, src: "tool" });
    }
  };
  function penBegin(T, host, e) {
    const key = "pen:" + ++gid;
    if (sel && layer && layer.pen && sel.tagName === T.tag && layer.pen.canContinue()) return layer.pen.begin(e, { key });
    penCleanup();
    const el = mk(T.tag, { ...shapeAttrs(), ...T.blank });
    host.insertBefore(el, host === ov.parentNode ? ov : null);
    const no = (cap) => {
      el.remove();
      if (sel === el) select(null);
      emit("denied", { el, attr: null, cap, reason: "capability", src: "tool" });
      return null;
    };
    if (!perms(el).selectable) return no("select");
    if (!perms(el).can("geometry.edit")) return no("geometry.edit");
    if (!perms(el).can("nodes.insert")) return no("nodes.insert");
    undoS.push({ key, t: Date.now(), items: [{ add: 1, el, parent: host, next: el.nextSibling }] });
    redoS.length = 0;
    emit("history");
    penEl = el;
    penPub = false;
    select(el);
    const G = sel === el && layer && layer.pen && layer.pen.begin(e, { key, first: true });
    if (!G) {
      penCleanup();
      if (el.isConnected) no("geometry.edit");
      return null;
    }
    return G;
  }
  function commit(el) {
    undoS.push({ key: "add:" + ++gid, t: Date.now(), items: [{ add: 1, el, parent: el.parentNode, next: el.nextSibling }] });
    redoS.length = 0;
    emit("history");
    emit("create", { el, src: "tool" });
    if (oneShot) {
      setTool("pointer");
      select(el);
    }
  }
  function toolDown(e) {
    if (ctxClick(e)) {
      e.stopPropagation();
      return;
    }
    if (tool === "pointer" || e.button !== 0 || gesture) return;
    const T = Tools.get(tool), host = hostEl(), M = host.getScreenCTM();
    if (!T || !M) return;
    if (T.pen && ov.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    const inv2 = M.inverse(), sc = Math.hypot(M.a, M.b) || 1, made = [], id = e.pointerId, g = { dead: false };
    const pt = (ev) => {
      const q = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(inv2);
      return [q.x, q.y];
    };
    const G = T.pen ? penBegin(T, host, e) : T.begin({ host, px: (n) => n / sc, make(tag, a) {
      const el = mk(tag, { ...shapeAttrs(), ...a });
      host.insertBefore(el, host === ov.parentNode ? ov : null);
      made.push(el);
      return el;
    } }, pt(e), e);
    if (!G) {
      svg.addEventListener("pointerup", () => {
        swallow = true;
        setTimeout(() => {
          swallow = false;
        });
      }, { once: true });
      return;
    }
    gesture = g;
    svg.setPointerCapture(id);
    const kill = () => {
      if (g.dead) return;
      g.dead = true;
      G.cancel && G.cancel();
      made.forEach((x) => x.remove());
    };
    const mv = (ev) => {
      if (ev.pointerId === id && !g.dead) G.move(pt(ev), ev);
    };
    const esc = (ev) => {
      if (ev.key === "Escape") kill();
    };
    const stop = () => {
      svg.removeEventListener("pointermove", mv);
      svg.removeEventListener("pointerup", up);
      svg.removeEventListener("pointercancel", cancel);
      removeEventListener("keydown", esc, true);
      gesture = null;
      swallow = true;
      setTimeout(() => {
        swallow = false;
      });
    };
    const up = (ev) => {
      if (ev.pointerId !== id) return;
      stop();
      if (g.dead) return;
      const el = G.end(pt(ev), ev);
      made.forEach((x) => x !== el && x.remove());
      if (el) commit(el);
      if (T.pen) penAfter();
    };
    const cancel = (ev) => {
      if (ev.pointerId !== id) return;
      kill();
      stop();
    };
    svg.addEventListener("pointermove", mv);
    svg.addEventListener("pointerup", up);
    svg.addEventListener("pointercancel", cancel);
    addEventListener("keydown", esc, true);
  }
  const menuB = [];
  const toolItems = () => {
    const ts = Tools.list.filter((d) => toolOk(d.id));
    if (!ts.length) return [];
    return [
      ...ONCE ? [{ label: "Use Once", submenu: ts.map((d) => ({ label: d.label, checked: oneShot && tool === d.id, action: () => setTool(d.id, true) })) }] : [],
      // TODO(remove) with ONCE
      { label: "Switch Tool", submenu: [
        { label: "Pointer", checked: tool === "pointer", action: () => setTool("pointer") },
        ...ts.map((d) => ({ label: d.label, checked: !oneShot && tool === d.id, action: () => setTool(d.id) }))
      ] }
    ];
  };
  menuB.push(toolItems);
  const PEN_SEGS = [["auto", "Auto (click: line, drag: curve)"], ["L", "Line"], ["Q", "Quadratic curve"], ["C", "Cubic curve"], ["A", "Arc"]];
  const penItems = () => {
    if (!penOn()) return [];
    const pn = layer && layer.pen;
    return [
      { label: "Next segment", submenu: PEN_SEGS.map(([k, l]) => ({ label: l, checked: penSeg === k, action: () => {
        api.penSegment = k;
      } })) },
      { label: "Close path", disabled: !(pn && pn.canClose()), action: () => pn && pn.close() },
      { label: "Finish path", action: penFinish }
    ];
  };
  menuB.push(penItems);
  const onPenHover = (e) => {
    if (!penOn() || gesture || e.pointerType === "touch") return;
    const pn = layer && layer.pen;
    svg.style.cursor = pn && pn.canContinue() ? "crosshair" : "cell";
    pn && pn.hover(ov.contains(e.target) ? null : e);
  };
  const onPenLeave = () => {
    layer && layer.pen && layer.pen.hover(null);
  };
  svg.addEventListener("pointermove", onPenHover);
  svg.addEventListener("pointerleave", onPenLeave);
  const closeMenu = () => {
    menuCtl && menuCtl.close();
    menuCtl = null;
  };
  function openMenu2(x, y, target = null) {
    const items = [];
    menuB.forEach((f2) => {
      const l = f2({ x, y, target, editor: api }) || [];
      if (l.length) {
        items.length && items.push({ sep: 1 });
        items.push(...l);
      }
    });
    if (!items.length) return false;
    closeMenu();
    menuCtl = openMenu(items, x, y, () => {
      menuCtl = null;
    });
    return true;
  }
  const onCtx = (e) => {
    if (lp) {
      e.preventDefault();
      lp.fire();
      return;
    }
    if (performance.now() - lpDone < 1e3) {
      e.preventDefault();
      return;
    }
    if (opts.menu === false || gesture) return;
    const t = ov.contains(e.target) ? null : e.target.closest?.(PRIM);
    if (openMenu2(e.clientX, e.clientY, t && root.contains(t) ? t : null)) e.preventDefault();
  };
  svg.addEventListener("pointerdown", toolDown, true);
  svg.addEventListener("contextmenu", onCtx);
  const api = {
    select,
    set(el, attr, val, src, o) {
      return setAttr(el, attr, val, src, void 0, o && o.force);
    },
    setMany(el, attrs, src, o) {
      return batch(() => {
        for (const a in attrs) setAttr(el, a, attrs[a], src, void 0, o && o.force);
      }, "many:" + ++bid);
    },
    // several attributes: checked together, undone together
    undo,
    redo,
    clearHistory,
    get canUndo() {
      return undoS.length > 0;
    },
    get canRedo() {
      return redoS.length > 0;
    },
    get selected() {
      return sel;
    },
    on,
    refresh() {
      emit("view");
    },
    changed(el, attr, src = "app") {
      emit("change", { el, attr, src });
    },
    destroy() {
      closeMenu();
      setTool("pointer");
      select(null);
      svg.removeEventListener("pointerdown", toolDown, true);
      svg.removeEventListener("contextmenu", onCtx);
      svg.removeEventListener("click", onClick);
      svg.removeEventListener("dblclick", onDbl);
      svg.removeEventListener("pointerdown", onLong);
      lpStop();
      svg.removeEventListener("pointerdown", onPress);
      svg.removeEventListener("pointermove", onHover);
      svg.removeEventListener("pointermove", onPenHover);
      svg.removeEventListener("pointerleave", onPenLeave);
      svg.removeEventListener("pointerdown", onDown, true);
      removeEventListener("keydown", onKey);
      if (!opts.overlay) ov.remove();
    },
    get mode() {
      return sel ? cur() : editing ? "edit" : pref;
    },
    set mode(m) {
      if (!MODES.includes(m) || m === api.mode) return;
      if (m === "edit") editing = true;
      else {
        pref = m;
        editing = false;
      }
      if (sel && cur() !== m) return;
      sel && build();
      emit("mode", m);
    },
    /* switch the shape (default: the selected one, which is selected first if it is another) to its own edit mode; false if it has none or the policy forbids it */
    edit(el = sel) {
      if (el && el !== sel) select(el);
      if (!sel || !canEdit(sel)) return false;
      if (cur() !== "edit") {
        editing = true;
        build();
        emit("mode", "edit");
      }
      return true;
    },
    get modes() {
      return sel ? modesFor(sel) : MODES;
    },
    get tool() {
      return tool;
    },
    set tool(id) {
      setTool(id);
    },
    useTool(id) {
      setTool(id, true);
    },
    // TODO(remove): useTool is sticky like tool= while ONCE is off
    get penSegment() {
      return penSeg;
    },
    set penSegment(k) {
      if (!PEN_SEGS.some((q) => q[0] === k) || k === penSeg) return;
      penSeg = k;
      emit("pen", { segment: k });
      layer && layer.pen && layer.pen.hover(null);
    },
    // what the pen's next node adds: 'auto' | 'L' | 'Q' | 'C' | 'A'
    get tools() {
      return Tools.list.filter((d) => toolOk(d.id)).map(({ id, label }) => ({ id, label }));
    },
    openMenu: openMenu2,
    closeMenu,
    addMenu(f2) {
      menuB.push(f2);
      return () => {
        const i = menuB.indexOf(f2);
        i >= 0 && menuB.splice(i, 1);
      };
    },
    /* permissions: can([el,] capability) and canSet([el,] attr) answer for host UIs (el defaults to the selected shape);
       policy (get/set) swaps the whole policy at runtime */
    can(a, b) {
      const el = typeof a === "string" ? sel : a;
      return !!el && perms(el).can(typeof a === "string" ? a : b);
    },
    canSet(a, b) {
      const el = typeof a === "string" ? sel : a;
      return !!el && canSet(perms(el), el.tagName, typeof a === "string" ? a : b);
    },
    range(a, b) {
      const el = typeof a === "string" ? sel : a;
      return el ? perms(el).range(typeof a === "string" ? a : b) : null;
    },
    // [min, max] (null = open end) the policy allows for an attribute, or null
    bounds(el = sel) {
      return el && perms(el).bounds ? { x: perms(el).bounds[0], y: perms(el).bounds[1], width: perms(el).bounds[2] - perms(el).bounds[0], height: perms(el).bounds[3] - perms(el).bounds[1] } : null;
    },
    snap(el = sel) {
      const s = el && perms(el).snap;
      return s ? { x: s[0], y: s[1] } : null;
    },
    // the grid step the policy imposes on the shape, in its own coordinates, or null
    get policy() {
      return P ? P.spec : null;
    },
    set policy(spec) {
      const np = compilePolicy(spec, { root });
      if (np) np.validate(root);
      P = np;
      if (tool !== "pointer" && !toolOk(tool)) setTool("pointer");
      if (!sel) return;
      if (!perms(sel).selectable) select(null);
      else build();
    },
    /* the edit-mode layer's own selection (path / polygon / polyline nodes, path segments): for host UIs and for hosts that attach with keys:false */
    deleteSelection() {
      return !!(layer && layer.deleteSelection && layer.deleteSelection());
    },
    clearSelection() {
      layer && layer.clearSelection && layer.clearSelection();
    },
    get selection() {
      return layer && layer.selection || null;
    },
    // {kind:'node'|'segment', items:[indices]} or null
    cycleMode() {
      if (!sel || cur() === "edit") return;
      const t = xmodes(sel);
      if (t.length < 2) return;
      cycLog.push({ t: performance.now(), from: pref });
      if (cycLog.length > 4) cycLog.shift();
      pref = t[(t.indexOf(cur()) + 1) % t.length];
      build();
      emit("mode", pref);
    }
  };
  return api;
}
export {
  attach,
  Tools as tools,
  Widgets as widgets
};
