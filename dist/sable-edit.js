/*! SableEdit (sable-edit.js) — drop-in SVG element editor (paths first). No dependencies.
  Usage:  const ed = SableEdit.attach(svgElement, { onChange(el,attr){...} });
  Options: root (limit editable subtree), overlay (existing <g> to draw handles in), mode ('scale'|'rotate'|'edit', default 'scale'),
           pick (default true: click an element to select it, click empty space to deselect),
           selector (editable elements, default basic shapes + path + text),
           onSelect(el), onChange(el, attr, src), onCreate(el),
           createIn (element or selector: where new shapes go, default root), shapeAttrs (attributes for new shapes, default a light
           fill + 2px stroke; if you pass `selector`, include something in shapeAttrs that matches it, e.g. {class:'edit'}),
           menu (default true: right-click / Ctrl-click opens the context menu; false leaves the browser's menu alone)
  Instance: select(el|null), selected, refresh() (call after you pan/zoom), changed(el, attr),
            set(el, attr, val, src) (undoable write; val null removes the attribute), undo(), redo(), clearHistory(),
            canUndo/canRedo, mode (get/set), modes (what the selected shape offers), cycleMode(),
            tool (get/set: 'pointer' or a tool id, stays until changed), useTool(id) (one use, then back to 'pointer'), tools (what is registered),
            openMenu(x,y), closeMenu(), addMenu(({x,y,target,editor}) => [items]) (returns a remover),
            on('select'|'change'|'history'|'mode'|'tool'|'create'|'remove', fn), destroy()   (Ctrl/Cmd+Z, +Shift or Ctrl+Y bound unless keys:false)
  Context menu: right-click (Ctrl-click on a Mac) anywhere on the canvas. 'Use Once' arms a tool for one shape, then returns to the pointer;
    'Switch Tool' keeps the tool until you pick Pointer (or press Esc). Items are {label, action, checked, disabled, submenu:[...]} or {sep:1}.
  Tools:    the pointer tool is the editing behaviour described below; other tools create shapes. Built in: circle (press = centre, drag = radius),
            rect (press = one corner, release = the opposite corner, any direction).
            A tool is armed -> every press is its gesture (nothing is selected, handles and the hub stay out of the way); Esc cancels a drag.
            A created shape is one undo step. A one-use tool selects the new shape; a switched-to tool stays armed with nothing selected.
            SableEdit.tools.register({id, label, cursor, begin(t, p0, ev) -> {move(p,ev), end(p,ev) -> element|null, cancel?()}})
            t = {host, px(n), make(tag, attrs)}; points are in the createIn container's coordinates.
  Widgets:  SableEdit.widgets.register(el=>bool, ctx=>({update(),destroy()}))   (a widget is a shape's *edit mode*)
            ctx = { el, overlay, matrix(), px(n), toLocal(pointerEvent), toParent(pointerEvent), toOverlay(pointerEvent),
                    bbox(), set(attr,val), on(evt,fn) }
  Handles are drawn in the overlay in the same space as the document, so editing happens in place.
  Modes: a selected shape has a hub (marked dot at the centre of its bounding box) in every mode: drag = move, click/tap = next mode.
    scale        bounding box in the shape's own frame; edge handles resize one axis, corners resize proportionally (opposite side fixed)
    rotate/skew  corners rotate about the centre (Shift = 15 degree steps), edge midpoints skew parallel to their edge
    edit         the shape's own controls (the registered widget). Shapes with only the catch-all widget (text...) skip this mode.
  Scale and rotate/skew work on any element by writing `transform` (compacted to translate/scale/rotate/matrix when a gesture ends).
  The hub rewrites rect/circle/ellipse/line/polygon/polyline/path coordinates directly and falls back to `transform` for the rest.
  Edit widgets: path, rect, circle, ellipse, line, polygon, polyline. Path editing: drag nodes/handles, Shift mirrors a cubic handle,
  double-click path = add node, double-click node = delete.
  Rect: two corner nodes (x1,y1 / x2,y2) and one corner-radius dot, inset from a free corner by (rx,ry); Shift = circular.
  Arcs: the active arc (click its end node or dot) shows its ellipse; the x-axis handle sets rx + rotation,
  the y-axis handle sets ry (Shift = circular); drag the dot across the chord to flip large-arc/sweep.
  The first edit normalizes `d` to absolute M/L/C/Q/A/Z. */
var SableEdit = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/index.js
  var index_exports = {};
  __export(index_exports, {
    attach: () => attach,
    tools: () => Tools,
    widgets: () => Widgets
  });

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
          out.push({ t: "L", pts: [[x, y]] });
          break;
        case "V":
          y = Y(a[0]);
          out.push({ t: "L", pts: [[x, y]] });
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
          out.push({ t: "C", pts: p });
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
          out.push({ t: "Q", pts: p });
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
  var serPath = (segs) => segs.map((s) => s.t === "Z" ? "Z" : s.t + (s.arc ? s.arc.join(" ") + " " : "") + s.pts.flat().map((v) => +v.toFixed(3)).join(" ")).join(" ");
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
    const gap = opts.gap || 0, r3 = (v) => +v.toFixed(3);
    let [rx, ry, phi, fa, fs] = arc;
    const g0 = arcGeom(P, E, rx, ry, phi, fa, fs);
    if (!g0) return arc;
    if (kind === "flip") {
      const dist = (q) => {
        const m = q.pt(q.th1 + q.dth / 2);
        return Math.hypot(m[0] - p[0], m[1] - p[1]);
      };
      let best = [fa, fs], bd = dist(g0);
      for (const a of [0, 1]) for (const s of [0, 1]) {
        const q = arcGeom(P, E, rx, ry, phi, a, s);
        if (q && dist(q) < bd - 1e-6) {
          bd = dist(q);
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
              const mid = (a + b) / 2, fm = res(mid);
              if (fm < 0 === fa_ < 0) {
                a = mid;
                fa_ = fm;
              } else b = mid;
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
    return [r3(rx), r3(ry), r3(phi), fa, fs];
  }

  // src/widgets/path.js
  Widgets.register((el) => el.tagName === "path", (ctx) => {
    const el = ctx.el, g = mk("g");
    ctx.overlay.append(g);
    let segs = parsePath(el.getAttribute("d") || ""), items = [], lines = [], hit, gh, dead = false, mv0 = false, mv1 = false, act = -1, arcs = [];
    const f2 = (v) => +v.toFixed(3), A2 = (e, o) => {
      for (const k in o) e.setAttribute(k, o[k]);
    };
    const ser = () => segs.map((s) => s.t === "Z" ? "Z" : s.t + (s.arc ? s.arc.join(" ") + " " : "") + s.pts.flat().map(f2).join(" ")).join(" ");
    const write = () => ctx.set("d", ser());
    const prevPt = (i) => {
      for (let j = i - 1; j >= 0; j--) if (segs[j].t !== "Z") return segs[j].pts.at(-1);
      return segs[i].pts[0];
    };
    const startOf = (i) => {
      for (let j = i; j >= 0; j--) if (segs[j].t === "M") return segs[j].pts[0];
    };
    function bind(h, onStart, onMove) {
      h.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        h.setPointerCapture(e.pointerId);
        const p0 = ctx.toLocal(e);
        onStart(p0);
        mv0 = mv1;
        mv1 = false;
        const mv = (ev) => {
          if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > 3) mv1 = true;
          onMove(ctx.toLocal(ev), p0, ev);
          write();
          layout();
        };
        h.addEventListener("pointermove", mv);
        h.addEventListener("pointerup", () => h.removeEventListener("pointermove", mv), { once: true });
      });
    }
    function ctl(s, k, i) {
      const h = mk("circle", { style: "pointer-events:all;cursor:move", fill: "var(--acc,#2f6fed)" });
      items.push({ el: h, get: () => s.pts[k], r: 3.5 });
      gh.append(h);
      bind(h, () => {
      }, (p, p0, ev) => {
        s.pts[k] = p;
        if (ev.shiftKey && s.t === "C") {
          const [o, oi, nd] = k ? [segs[i + 1], 0, s.pts[2]] : [segs[i - 1], 1, prevPt(i)];
          if (o?.t === "C") o.pts[oi] = [2 * nd[0] - p[0], 2 * nd[1] - p[1]];
        }
      });
    }
    function node(s, i) {
      const h = mk("rect", { style: "pointer-events:all;cursor:move", fill: "var(--panel,#fff)", stroke: "var(--acc,#2f6fed)" });
      items.push({ el: h, get: () => s.pts.at(-1), r: 5, n: 1 });
      gh.append(h);
      let refs = [];
      bind(h, () => {
        if (s.t === "A") {
          act = i;
          layout();
        }
        const nx = segs[i + 1];
        refs = [[s, s.pts.length - 1]];
        if (s.t === "C") refs.push([s, 1]);
        if (nx?.t === "C") refs.push([nx, 0]);
        refs = refs.map(([q, k]) => [q, k, [...q.pts[k]]]);
      }, (p, p0) => {
        const dx = p[0] - p0[0], dy = p[1] - p0[1];
        refs.forEach(([q, k, o]) => q.pts[k] = [o[0] + dx, o[1] + dy]);
      });
      h.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        if (mv0 || mv1 || segs.filter((q) => q.t !== "Z").length < 3) return;
        if (s.t === "M") {
          const n = segs[i + 1];
          if (!n || n.t === "Z") return;
          n.t = "M";
          n.pts = [n.pts.at(-1)];
          delete n.arc;
        }
        segs.splice(i, 1);
        write();
        build();
      });
    }
    function insert(p) {
      let best = null;
      segs.forEach((s2, i2) => {
        if (s2.t === "M" || s2.t === "A") return;
        const P = prevPt(i2), cp2 = s2.t === "Z" ? [P, startOf(i2)] : s2.t === "L" ? [P, s2.pts[0]] : [P, ...s2.pts];
        for (let k = 1; k < 32; k++) {
          const q = dc(cp2, k / 32), d = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (!best || d < best.d) best = { d, i: i2, t: k / 32, cp: cp2 };
        }
      });
      if (!best) return;
      const { i, t, cp } = best, s = segs[i], [L, R2] = split(cp, t);
      if (s.t === "Z") segs.splice(i, 0, { t: "L", pts: [L.at(-1)] });
      else segs.splice(i, 1, { t: s.t, pts: L.slice(1) }, { t: s.t, pts: R2.slice(1) });
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
      ln(ctr(i), ends(i, 0, 1), { arc: i, dash: 1, op: 0.8 });
      ln(ctr(i), ends(i, 1, 1), { arc: i, dash: 1, op: 0.8 });
      const rotPos = () => {
        const q = geom(i);
        if (!q) return null;
        const d = q.rx + gapL();
        return [q.cx - d * q.c, q.cy - d * q.s];
      };
      ln(() => {
        const q = geom(i);
        return q && [q.cx - q.rx * q.c, q.cy - q.rx * q.s];
      }, rotPos, { arc: i });
      const drag = (h, pos, kind, r, fill) => {
        items.push({ el: h, arc: i, r, get: pos });
        let off = [0, 0];
        bind(
          h,
          (p0) => {
            const c = pos();
            off = c ? [p0[0] - c[0], p0[1] - c[1]] : [0, 0];
            act = i;
            layout();
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
      items.push({ el: hm, arc: i, always: 1, r: 4.5, get: () => {
        const q = geom(i);
        return q && q.pt(q.th1 + q.dth / 2);
      } });
      let offm = [0, 0];
      bind(
        hm,
        (p0) => {
          const c = geom(i) && geom(i).pt(geom(i).th1 + geom(i).dth / 2);
          offm = c ? [p0[0] - c[0], p0[1] - c[1]] : [0, 0];
          act = i;
          layout();
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
      if (!(segs[act] && segs[act].t === "A")) act = segs.findIndex((q) => q.t === "A");
      hit = mk("path", { fill: "none", stroke: "transparent", "stroke-width": 12, "vector-effect": "non-scaling-stroke", style: "pointer-events:stroke;cursor:copy" });
      hit.addEventListener("dblclick", (e) => insert(ctx.toLocal(e)));
      g.append(hit);
      gh = mk("g");
      segs.forEach((s, i) => {
        if (s.t === "C") {
          ln(() => prevPt(i), () => s.pts[0]);
          ln(() => s.pts[1], () => s.pts[2]);
          ctl(s, 0, i);
          ctl(s, 1, i);
        }
        if (s.t === "Q") {
          ln(() => prevPt(i), () => s.pts[0]);
          ln(() => s.pts[0], () => s.pts[1]);
          ctl(s, 0, i);
        }
        if (s.t === "A") arcHandles(s, i);
      });
      segs.forEach((s, i) => s.t !== "Z" && node(s, i));
      g.append(gh);
      layout();
    }
    function layout() {
      const M = ctx.matrix(), T = (p) => {
        const q = new DOMPoint(p[0], p[1]).matrixTransform(M);
        return [q.x, q.y];
      }, w = ctx.px(1.5);
      A2(hit, { d: ser(), transform: `matrix(${M.a} ${M.b} ${M.c} ${M.d} ${M.e} ${M.f})` });
      lines.forEach((l) => {
        const a0 = l.a(), b0 = l.b(), on = a0 && b0 && (l.arc === void 0 || l.arc === act);
        l.el.style.display = on ? "" : "none";
        if (!on) return;
        const a = T(a0), b = T(b0);
        A2(l.el, { x1: a[0], y1: a[1], x2: b[0], y2: b[1], "stroke-width": ctx.px(1), "stroke-dasharray": l.dash ? ctx.px(2) + " " + ctx.px(3) : "none" });
      });
      items.forEach((it) => {
        const pt = it.arc !== void 0 && it.arc !== act && !it.always ? null : it.get();
        it.el.style.display = pt ? "" : "none";
        if (!pt) return;
        const [x, y] = T(pt), r = ctx.px(it.r);
        A2(it.el, it.n ? { x: x - r, y: y - r, width: 2 * r, height: 2 * r, "stroke-width": w } : { cx: x, cy: y, r, "stroke-width": w });
      });
      arcs.forEach(({ i, ell }) => {
        const q = i === act && geom(i);
        ell.style.display = q ? "" : "none";
        if (q) A2(ell, { rx: q.rx, ry: q.ry, transform: `matrix(${M.a} ${M.b} ${M.c} ${M.d} ${M.e} ${M.f}) translate(${q.cx} ${q.cy}) rotate(${q.phi * 180 / Math.PI})` });
      });
    }
    ctx.on("view", () => !dead && layout());
    ctx.on("change", ({ el: e, src }) => {
      if (dead || e !== el || src === "widget") return;
      segs = parsePath(el.getAttribute("d") || "");
      build();
    });
    build();
    return { update() {
      segs = parsePath(el.getAttribute("d") || "");
      build();
    }, destroy() {
      dead = true;
      g.remove();
    } };
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
        const [x, y] = T(sp.get()), r = ctx.px(sp.sq ? 5 : 4.5);
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

  // src/util.js
  var num = (el, a) => parseFloat(el.getAttribute(a)) || 0;
  var rnd = (v) => +v.toFixed(3);
  var box4 = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

  // src/widgets/shapes.js
  Widgets.register((el) => el.tagName === "rect", (ctx) => {
    const el = ctx.el, rect = () => ({ x: num(el, "x"), y: num(el, "y"), w: num(el, "width"), h: num(el, "height") });
    let A2, B, a0, b0, rr0, busy = false;
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
        ctx.set("x", rnd(q.x));
        ctx.set("y", rnd(q.y));
        ctx.set("width", rnd(q.w));
        ctx.set("height", rnd(q.h));
      } finally {
        busy = false;
      }
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
    return handleWidget(ctx, specs, () => {
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
    const el = ctx.el, P = (a, b) => [num(el, a), num(el, b)];
    return handleWidget(ctx, [
      { sq: 1, get: () => P("x1", "y1"), drag: (p) => {
        ctx.set("x1", rnd(p[0]));
        ctx.set("y1", rnd(p[1]));
      } },
      { sq: 1, get: () => P("x2", "y2"), drag: (p) => {
        ctx.set("x2", rnd(p[0]));
        ctx.set("y2", rnd(p[1]));
      } }
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
    let pts = parse(), items = [], hit, dead = false, mv0 = false, mv1 = false;
    const write = () => ctx.set("points", pts.map((p) => rnd(p[0]) + "," + rnd(p[1])).join(" "));
    function drag(h, start, move) {
      h.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        h.setPointerCapture(e.pointerId);
        const p0 = ctx.toLocal(e);
        start();
        mv0 = mv1;
        mv1 = false;
        const mv = (ev) => {
          if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > 3) mv1 = true;
          move(ctx.toLocal(ev), p0);
          write();
          layout();
        };
        h.addEventListener("pointermove", mv);
        h.addEventListener("pointerup", () => h.removeEventListener("pointermove", mv), { once: true });
      });
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
      write();
      build();
    }
    function build() {
      g.replaceChildren();
      items = [];
      hit = mk(tag, { fill: "none", stroke: "transparent", "stroke-width": 12, "vector-effect": "non-scaling-stroke", style: "pointer-events:stroke;cursor:copy" });
      hit.addEventListener("dblclick", (e) => insert(ctx.toLocal(e)));
      g.append(hit);
      pts.forEach((_, i) => {
        const h = mk("rect", { style: "pointer-events:all;cursor:move", fill: "var(--panel,#fff)", stroke: "var(--acc,#2f6fed)" });
        g.append(h);
        items.push({ h, get: () => pts[i], r: 5, n: 1 });
        drag(h, () => {
        }, (p) => {
          pts[i] = p;
        });
        h.addEventListener("dblclick", (e) => {
          e.stopPropagation();
          if (mv0 || mv1 || pts.length <= (closed ? 3 : 2)) return;
          pts.splice(i, 1);
          write();
          build();
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
      });
    }
    ctx.on("view", () => !dead && layout());
    ctx.on("change", ({ el: e, src }) => {
      if (dead || e !== el || src === "widget") return;
      pts = parse();
      build();
    });
    build();
    return { update() {
      pts = parse();
      build();
    }, destroy() {
      dead = true;
      g.remove();
    } };
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
    const near = (x, y) => Math.abs(x - y) < 1e-7, r = (v) => +v.toFixed(6), q = (v) => +v.toFixed(3);
    const tr = Math.abs(e) > 1e-9 || Math.abs(f2) > 1e-9 ? `translate(${q(e)} ${q(f2)})` : "";
    let rest = "";
    if (near(b, 0) && near(c, 0)) {
      if (!(near(a, 1) && near(d, 1))) rest = `scale(${r(a)}${near(a, d) ? "" : " " + r(d)})`;
    } else if (near(a, d) && near(b, -c) && near(a * a + b * b, 1)) rest = `rotate(${+(Math.atan2(b, a) * 180 / Math.PI).toFixed(4)})`;
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
  var CROSS = `M-5 0H5M0-5V5${chev(5, 0, 0)}${chev(-5, 0, Math.PI)}${chev(0, 5, Math.PI / 2)}${chev(0, -5, -Math.PI / 2)}`;

  // src/widgets/transform.js
  var ACC = "var(--acc,#2f6fed)";
  var PANEL = "var(--panel,#fff)";
  var r6 = (v) => +v.toFixed(6);
  var cursor = (a) => ["ew", "nwse", "ns", "nesw"][Math.round((a % Math.PI + Math.PI) % Math.PI / (Math.PI / 4)) % 4] + "-resize";
  var nz = (s) => Math.abs(s) < 1e-3 ? s < 0 ? -1e-3 : 1e-3 : s;
  function transformLayer(ctx, kind) {
    const el = ctx.el, g = mk("g"), A2 = (e, o) => {
      for (const k in o) e.setAttribute(k, o[k]);
    }, ol = mk("polygon", { fill: "none", stroke: ACC });
    g.append(ol);
    ctx.overlay.append(g);
    let dead = false;
    const frame = (e, hx, hy) => {
      const inv = ctx.matrix().inverse(), loc = (ev) => {
        const o = ctx.toOverlay(ev), q = new DOMPoint(o[0], o[1]).matrixTransform(inv);
        return [q.x, q.y];
      }, p0 = loc(e);
      return { b: ctx.bbox(), t0: el.getAttribute("transform") || "", dirty: false, at: (ev) => {
        const p = loc(ev);
        return [hx + p[0] - p0[0], hy + p[1] - p0[1]];
      } };
    };
    const put = (S, pre, post) => {
      ctx.set("transform", [pre, S.t0, post].filter(Boolean).join(" "));
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
        const G = begin[role](ix, iy)(e);
        if (!G) return;
        const mv = (ev) => G.move(ev);
        h.addEventListener("pointermove", mv);
        h.addEventListener("pointerup", () => {
          h.removeEventListener("pointermove", mv);
          if (G.S.dirty) ctx.set("transform", fmtTransform(ownM(el)));
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
        const [x, y] = T(b.x + b.w * s.ix, b.y + b.h * s.iy);
        const v = s.role === "sc" || s.role === "rot" ? [x - C[0], y - C[1]] : s.role === "sx" || s.role === "kx" ? [M.a, M.b] : [M.c, M.d], a = Math.atan2(v[1], v[0]);
        A2(s.g, { transform: `translate(${x} ${y}) rotate(${a * 180 / Math.PI}) scale(${ctx.px(1)})` });
        s.g.style.cursor = s.role === "rot" ? "grab" : cursor(a);
        const e = 1e-9, live2 = { sc: b.w > e || b.h > e, sx: b.w > e, sy: b.h > e, rot: true, kx: b.h > e, ky: b.w > e }[s.role];
        s.g.style.display = live2 ? "" : "none";
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

  // src/widgets/hub.js
  var ACC2 = "var(--acc,#2f6fed)";
  var PANEL2 = "var(--panel,#fff)";
  function hubWidget(ctx, { modes, index, cycle, moved }) {
    const el = ctx.el, g = mk("g"), h = mk("g", { style: "pointer-events:all;cursor:move" });
    let dead = false;
    const title = mk("title");
    title.textContent = "Drag to move \xB7 click for the next mode (" + modes[index] + ")";
    h.append(
      title,
      mk("circle", { r: 12, fill: "none", stroke: ACC2, "stroke-width": 1 }),
      mk("circle", { r: 9, fill: ACC2, stroke: PANEL2, "stroke-width": 1.6 }),
      mk("path", { d: CROSS, fill: "none", stroke: PANEL2, "stroke-width": 1.3, "stroke-linecap": "round", "stroke-linejoin": "round" })
    );
    g.append(h);
    modes.forEach((_, i) => g.append(mk("circle", { cx: (i - (modes.length - 1) / 2) * 6, cy: 17, r: 2, fill: i === index ? ACC2 : PANEL2, stroke: ACC2, "stroke-width": 1, style: "pointer-events:none" })));
    ctx.overlay.append(g);
    function layout() {
      const b = ctx.bbox();
      g.style.display = b ? "" : "none";
      if (!b) return;
      const q = new DOMPoint(b.x + b.w / 2, b.y + b.h / 2).matrixTransform(ctx.matrix());
      g.setAttribute("transform", `translate(${q.x} ${q.y}) scale(${ctx.px(1)})`);
    }
    h.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      h.setPointerCapture(e.pointerId);
      const x0 = e.clientX, y0 = e.clientY, t0 = el.getAttribute("transform") || "", mv = mover(ctx), l0 = ctx.toLocal(e), p0 = ctx.toParent(e);
      let go = false;
      const move = (ev) => {
        if (!go) {
          if (Math.hypot(ev.clientX - x0, ev.clientY - y0) <= 3) return;
          go = true;
        }
        if (mv) {
          const p = ctx.toLocal(ev);
          mv(p[0] - l0[0], p[1] - l0[1]);
        } else {
          const p = ctx.toParent(ev);
          ctx.set("transform", `translate(${rnd(p[0] - p0[0])} ${rnd(p[1] - p0[1])})` + (t0 ? " " + t0 : ""));
        }
        moved();
      };
      h.addEventListener("pointermove", move);
      h.addEventListener("pointerup", () => {
        h.removeEventListener("pointermove", move);
        if (!go) cycle();
        else if (!mv) ctx.set("transform", fmtTransform(ownM(el)));
      }, { once: true });
    });
    ctx.on("view", () => !dead && layout());
    ctx.on("change", () => !dead && layout());
    layout();
    return { update: layout, destroy() {
      dead = true;
      g.remove();
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
    let sel = null, layer = null, hub = null, subs = [], pref = MODES.includes(opts.mode) ? opts.mode : "scale";
    let tool = "pointer", oneShot = false, gesture = null, swallow = false, menuCtl = null;
    const undoS = [], redoS = [];
    let gid = 0;
    const record = (el, attr, old, nw, src) => {
      const key = src + ":" + (src === "widget" ? gid : attr), now = Date.now(), last = undoS.at(-1);
      if (last && last.key === key && (src === "widget" || now - last.t < 800)) {
        const it = last.items.find((i) => i.el === el && i.attr === attr);
        it ? it.nw = nw : last.items.push({ el, attr, old, nw });
        last.t = now;
      } else undoS.push({ key, t: now, items: [{ el, attr, old, nw }] });
      redoS.length = 0;
      emit("history");
    };
    const setAttr = (el, attr, v, src = "app") => {
      const old = el.getAttribute(attr), nw = v === null ? null : String(v);
      if (old === nw) return;
      nw === null ? el.removeAttribute(attr) : el.setAttribute(attr, nw);
      record(el, attr, old, nw, src);
      emit("change", { el, attr, src });
    };
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
      if (e.key === "Escape") {
        if (!gesture && tool !== "pointer") setTool("pointer");
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
      const e = Widgets.find(el);
      return e && !e.generic ? MODES : MODES.slice(0, 2);
    };
    const cur = () => {
      const ms = modesFor(sel);
      return ms.includes(pref) ? pref : ms[0];
    };
    const unsub = () => {
      subs.forEach(([e, f2]) => {
        const a = hs[e], i = a ? a.indexOf(f2) : -1;
        if (i >= 0) a.splice(i, 1);
      });
      subs = [];
    };
    const teardown = () => {
      layer?.destroy();
      hub?.destroy();
      layer = hub = null;
      unsub();
      ov.replaceChildren();
    };
    let ctx = null;
    function build() {
      teardown();
      const m = cur(), ms = modesFor(sel);
      layer = m === "edit" ? Widgets.find(sel).factory(ctx) : transformLayer(ctx, m);
      hub = hubWidget(ctx, { modes: ms, index: ms.indexOf(m), cycle: () => api.cycleMode(), moved: () => layer.update && layer.update() });
    }
    function select(el) {
      if (el === sel) return;
      teardown();
      sel = el;
      ctx = null;
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
          set(a, v, src = "widget") {
            setAttr(el, a, v, src);
          }
        };
        build();
      }
      emit("select", el);
    }
    const onClick = (e) => {
      if (swallow) {
        swallow = false;
        return;
      }
      if (ov.contains(e.target) || ctxClick(e)) return;
      const t = e.target.closest?.(PRIM);
      select(t && root.contains(t) ? t : null);
    };
    if (opts.pick !== false) svg.addEventListener("click", onClick);
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
      if (id !== "pointer" && !T) return;
      once = once && id !== "pointer";
      if (id === tool && once === oneShot) return;
      tool = id;
      oneShot = once;
      svg.style.cursor = T ? T.cursor || "crosshair" : cursorWas;
      if (T) select(null);
      emit("tool", id);
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
      e.preventDefault();
      e.stopPropagation();
      const inv = M.inverse(), sc = Math.hypot(M.a, M.b) || 1, made = [], id = e.pointerId, g = gesture = { dead: false };
      const pt = (ev) => {
        const q = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(inv);
        return [q.x, q.y];
      };
      const G = T.begin({ host, px: (n) => n / sc, make(tag, a) {
        const el = mk(tag, { ...shapeAttrs(), ...a });
        host.insertBefore(el, host === ov.parentNode ? ov : null);
        made.push(el);
        return el;
      } }, pt(e), e);
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
      const ts = Tools.list;
      if (!ts.length) return [];
      return [
        { label: "Use Once", submenu: ts.map((d) => ({ label: d.label, checked: oneShot && tool === d.id, action: () => setTool(d.id, true) })) },
        { label: "Switch Tool", submenu: [
          { label: "Pointer", checked: tool === "pointer", action: () => setTool("pointer") },
          ...ts.map((d) => ({ label: d.label, checked: !oneShot && tool === d.id, action: () => setTool(d.id) }))
        ] }
      ];
    };
    menuB.push(toolItems);
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
      if (opts.menu === false || gesture) return;
      const t = ov.contains(e.target) ? null : e.target.closest?.(PRIM);
      if (openMenu2(e.clientX, e.clientY, t && root.contains(t) ? t : null)) e.preventDefault();
    };
    svg.addEventListener("pointerdown", toolDown, true);
    svg.addEventListener("contextmenu", onCtx);
    const api = {
      select,
      set: setAttr,
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
        svg.removeEventListener("pointerdown", onDown, true);
        removeEventListener("keydown", onKey);
        if (!opts.overlay) ov.remove();
      },
      get mode() {
        return sel ? cur() : pref;
      },
      set mode(m) {
        if (!MODES.includes(m) || m === api.mode) return;
        pref = m;
        if (sel && cur() !== m) return;
        sel && build();
        emit("mode", m);
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
      get tools() {
        return Tools.list.map(({ id, label }) => ({ id, label }));
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
      cycleMode() {
        if (!sel) return;
        const ms = modesFor(sel);
        pref = ms[(ms.indexOf(cur()) + 1) % ms.length];
        build();
        emit("mode", pref);
      }
    };
    return api;
  }
  return __toCommonJS(index_exports);
})();
