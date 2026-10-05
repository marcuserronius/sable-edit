/*! SableEdit (sable-edit.js) — drop-in SVG element editor (paths first). No dependencies.
  Usage:  const ed = SableEdit.attach(svgElement, { onChange(el,attr){...} });
  Options: root (limit editable subtree), overlay (existing <g> to draw handles in),
           pick (default true: click an element to select it, click empty space to deselect),
           selector (editable elements, default basic shapes + path + text),
           onSelect(el), onChange(el, attr, src)
  Instance: select(el|null), selected, refresh() (call after you pan/zoom), changed(el, attr),
            set(el, attr, val, src) (undoable write), undo(), redo(), clearHistory(), canUndo/canRedo,
            on('select'|'change'|'history', fn), destroy()   (Ctrl/Cmd+Z, +Shift or Ctrl+Y bound unless keys:false)
  Widgets:  SableEdit.widgets.register(el=>bool, ctx=>({update(),destroy()}))
            ctx = { el, overlay, matrix(), px(n), toLocal(pointerEvent), set(attr,val), on(evt,fn) }
  Handles are drawn in the overlay in the same space as the document, so editing happens in place.
  Widgets: path, rect, circle, ellipse, line, polygon, polyline. Path editing: drag nodes/handles, Shift mirrors a cubic handle, double-click path = add node,
  double-click node = delete.
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
    widgets: () => Widgets
  });

  // src/registry.js
  var Widgets = {
    list: [],
    register(match, factory) {
      this.list.push({ match, factory });
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

  // src/util.js
  var num = (el, a) => parseFloat(el.getAttribute(a)) || 0;
  var rnd = (v) => +v.toFixed(3);
  var box4 = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

  // src/path-math.js
  var lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  var dc = (p, t) => p.length === 1 ? p[0] : dc(p.slice(1).map((q, k) => lerp(p[k], q, t)), t);
  var split = (p, t) => {
    const L = [], R = [];
    let q = p;
    while (q.length) {
      L.push(q[0]);
      R.unshift(q.at(-1));
      q = q.slice(1).map((v, k) => lerp(q[k], v, t));
    }
    return [L, R];
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

  // src/widgets/path.js
  Widgets.register((el) => el.tagName === "path", (ctx) => {
    const el = ctx.el, g = mk("g");
    ctx.overlay.append(g);
    let segs = parsePath(el.getAttribute("d") || ""), items = [], lines = [], hit, gh, dead = false, mv0 = false, mv1 = false, act = -1, arcs = [];
    const f = (v) => +v.toFixed(3), A = (e, o) => {
      for (const k in o) e.setAttribute(k, o[k]);
    };
    const ser = () => segs.map((s) => s.t === "Z" ? "Z" : s.t + (s.arc ? s.arc.join(" ") + " " : "") + s.pts.flat().map(f).join(" ")).join(" ");
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
      const { i, t, cp } = best, s = segs[i], [L, R] = split(cp, t);
      if (s.t === "Z") segs.splice(i, 0, { t: "L", pts: [L.at(-1)] });
      else segs.splice(i, 1, { t: s.t, pts: L.slice(1) }, { t: s.t, pts: R.slice(1) });
      write();
      build();
    }
    const geom = (i) => {
      const s = segs[i];
      return s && s.t === "A" ? arcGeom(prevPt(i), s.pts[0], ...s.arc) : null;
    };
    function arcHandles(s, i) {
      const mkh = (sq, fill) => {
        const h = mk(sq ? "rect" : "circle", { style: "pointer-events:all;cursor:move", fill: sq ? "var(--panel,#fff)" : fill, stroke: "var(--acc,#2f6fed)" });
        gh.append(h);
        return h;
      };
      arcs.push({ i, ell: g.appendChild(mk("ellipse", { fill: "none", stroke: "var(--acc,#2f6fed)", opacity: 0.6, "vector-effect": "non-scaling-stroke", "stroke-dasharray": "5 3" })) });
      const hx = mkh(1);
      items.push({ el: hx, arc: i, n: 1, r: 5, get: () => {
        const q = geom(i);
        return q && [q.cx + q.rx * q.c, q.cy + q.rx * q.s];
      } });
      bind(hx, () => {
        act = i;
        layout();
      }, (p, p0, ev) => {
        const q = geom(i);
        if (!q) return;
        const dx = p[0] - q.cx, dy = p[1] - q.cy, d = Math.max(Math.hypot(dx, dy), 0.1);
        s.arc[0] = rnd(d);
        if (ev.shiftKey) s.arc[1] = rnd(d);
        s.arc[2] = rnd(Math.atan2(dy, dx) * 180 / Math.PI);
      });
      const hy = mkh(1);
      items.push({ el: hy, arc: i, n: 1, r: 5, get: () => {
        const q = geom(i);
        return q && [q.cx - q.ry * q.s, q.cy + q.ry * q.c];
      } });
      bind(hy, () => {
        act = i;
        layout();
      }, (p, p0, ev) => {
        const q = geom(i);
        if (!q) return;
        const d = Math.max(Math.abs((p[0] - q.cx) * -q.s + (p[1] - q.cy) * q.c), 0.1);
        s.arc[1] = rnd(d);
        if (ev.shiftKey) s.arc[0] = rnd(d);
      });
      const hm = mkh(0, "var(--acc,#2f6fed)");
      items.push({ el: hm, arc: i, always: 1, r: 4.5, get: () => {
        const q = geom(i);
        return q && q.pt(q.th1 + q.dth / 2);
      } });
      bind(hm, () => {
        act = i;
        layout();
      }, (p) => {
        const P = prevPt(i), E = s.pts[0], dist = (q) => {
          const m = q.pt(q.th1 + q.dth / 2);
          return Math.hypot(m[0] - p[0], m[1] - p[1]);
        };
        const q0 = geom(i);
        let best = [s.arc[3], s.arc[4]], bd = q0 ? dist(q0) : 1e9;
        for (const fa of [0, 1]) for (const fs of [0, 1]) {
          const q = arcGeom(P, E, s.arc[0], s.arc[1], s.arc[2], fa, fs);
          if (q && dist(q) < bd - 1e-6) {
            bd = dist(q);
            best = [fa, fs];
          }
        }
        s.arc[3] = best[0];
        s.arc[4] = best[1];
      });
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
      const ln = (a, b) => {
        const l = mk("line", { stroke: "var(--acc,#2f6fed)", opacity: 0.55 });
        lines.push({ el: l, a, b });
        g.append(l);
      };
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
      A(hit, { d: ser(), transform: `matrix(${M.a} ${M.b} ${M.c} ${M.d} ${M.e} ${M.f})` });
      lines.forEach((l) => {
        const a = T(l.a()), b = T(l.b());
        A(l.el, { x1: a[0], y1: a[1], x2: b[0], y2: b[1], "stroke-width": ctx.px(1) });
      });
      items.forEach((it) => {
        const pt = it.arc !== void 0 && it.arc !== act && !it.always ? null : it.get();
        it.el.style.display = pt ? "" : "none";
        if (!pt) return;
        const [x, y] = T(pt), r = ctx.px(it.r);
        A(it.el, it.n ? { x: x - r, y: y - r, width: 2 * r, height: 2 * r, "stroke-width": w } : { cx: x, cy: y, r, "stroke-width": w });
      });
      arcs.forEach(({ i, ell }) => {
        const q = i === act && geom(i);
        ell.style.display = q ? "" : "none";
        if (q) A(ell, { rx: q.rx, ry: q.ry, transform: `matrix(${M.a} ${M.b} ${M.c} ${M.d} ${M.e} ${M.f}) translate(${q.cx} ${q.cy}) rotate(${q.phi * 180 / Math.PI})` });
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
    const g = mk("g"), A = (e, o) => {
      for (const k in o) e.setAttribute(k, o[k]);
    };
    ctx.overlay.append(g);
    let dead = false;
    const ol = outline && mk("polygon", { fill: "none", stroke: "var(--acc,#2f6fed)" });
    ol && g.append(ol);
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
      if (ol) A(ol, { points: outline().map(T).join(" "), "stroke-width": w, "stroke-dasharray": ctx.px(5) + " " + ctx.px(3) });
      items.forEach(({ el, sp }) => {
        const [x, y] = T(sp.get()), r = ctx.px(sp.sq ? 5 : 4.5);
        A(el, sp.sq ? { x: x - r, y: y - r, width: 2 * r, height: 2 * r, "stroke-width": w } : { cx: x, cy: y, r, "stroke-width": w });
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
    let r0;
    const specs = [];
    for (const iy of [0, 0.5, 1]) for (const ix of [0, 0.5, 1]) {
      const mid = ix === 0.5 && iy === 0.5;
      specs.push({ sq: !mid, get: () => {
        const r = rect();
        return [r.x + r.w * ix, r.y + r.h * iy];
      }, start: () => {
        r0 = rect();
      }, drag: (p, p0) => {
        let { x, y, w, h } = r0;
        if (mid) {
          x += p[0] - p0[0];
          y += p[1] - p0[1];
        } else {
          if (ix !== 0.5) {
            const a = ix ? x : x + w;
            x = Math.min(a, p[0]);
            w = Math.abs(a - p[0]);
          }
          if (iy !== 0.5) {
            const a = iy ? y : y + h;
            y = Math.min(a, p[1]);
            h = Math.abs(a - p[1]);
          }
        }
        ctx.set("x", rnd(x));
        ctx.set("y", rnd(y));
        if (!mid) {
          ctx.set("width", rnd(w));
          ctx.set("height", rnd(h));
        }
      } });
    }
    return handleWidget(ctx, specs, () => {
      const r = rect();
      return box4(r.x, r.y, r.w, r.h);
    });
  });
  for (const tag of ["circle", "ellipse"]) Widgets.register((el) => el.tagName === tag, (ctx) => {
    const el = ctx.el, c = () => [num(el, "cx"), num(el, "cy")], ell = tag === "ellipse";
    let c0;
    const rx = () => num(el, ell ? "rx" : "r"), ry = () => num(el, ell ? "ry" : "r");
    const specs = [
      { get: c, start: () => {
        c0 = c();
      }, drag: (p, p0) => {
        ctx.set("cx", rnd(c0[0] + p[0] - p0[0]));
        ctx.set("cy", rnd(c0[1] + p[1] - p0[1]));
      } },
      { sq: 1, get: () => [c()[0] + rx(), c()[1]], drag: (p) => ctx.set(ell ? "rx" : "r", rnd(ell ? Math.abs(p[0] - c()[0]) : Math.hypot(p[0] - c()[0], p[1] - c()[1]))) }
    ];
    if (ell) specs.push({ sq: 1, get: () => [c()[0], c()[1] + ry()], drag: (p) => ctx.set("ry", rnd(Math.abs(p[1] - c()[1]))) });
    return handleWidget(ctx, specs, () => box4(c()[0] - rx(), c()[1] - ry(), 2 * rx(), 2 * ry()));
  });
  Widgets.register((el) => el.tagName === "line", (ctx) => {
    const el = ctx.el, P = (a, b) => [num(el, a), num(el, b)];
    let s0;
    return handleWidget(ctx, [
      { sq: 1, get: () => P("x1", "y1"), drag: (p) => {
        ctx.set("x1", rnd(p[0]));
        ctx.set("y1", rnd(p[1]));
      } },
      { sq: 1, get: () => P("x2", "y2"), drag: (p) => {
        ctx.set("x2", rnd(p[0]));
        ctx.set("y2", rnd(p[1]));
      } },
      {
        get: () => {
          const a = P("x1", "y1"), b = P("x2", "y2");
          return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        },
        start: () => {
          s0 = ["x1", "y1", "x2", "y2"].map((k) => num(el, k));
        },
        drag: (p, p0) => {
          const dx = p[0] - p0[0], dy = p[1] - p0[1];
          ["x1", "y1", "x2", "y2"].forEach((k, i) => ctx.set(k, rnd(s0[i] + (i % 2 ? dy : dx))));
        }
      }
    ]);
  });

  // src/widgets/poly.js
  for (const tag of ["polygon", "polyline"]) Widgets.register((el) => el.tagName === tag, (ctx) => {
    const el = ctx.el, closed = tag === "polygon", g = mk("g"), A = (e, o) => {
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
    const centroid = () => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
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
      if (pts.length) {
        const c = mk("circle", { style: "pointer-events:all;cursor:move", fill: "var(--acc,#2f6fed)", stroke: "var(--acc,#2f6fed)" });
        g.append(c);
        items.push({ h: c, get: centroid, r: 4.5 });
        let o;
        drag(c, () => {
          o = pts.map((q) => [...q]);
        }, (p, p0) => {
          pts = o.map((q) => [q[0] + p[0] - p0[0], q[1] + p[1] - p0[1]]);
        });
      }
      layout();
    }
    function layout() {
      const M = ctx.matrix(), T = (p) => {
        const q = new DOMPoint(p[0], p[1]).matrixTransform(M);
        return [q.x, q.y];
      }, w = ctx.px(1.5);
      A(hit, { points: pts.map((p) => p.join(",")).join(" "), transform: `matrix(${M.a} ${M.b} ${M.c} ${M.d} ${M.e} ${M.f})` });
      items.forEach((it) => {
        const [x, y] = T(it.get()), r = ctx.px(it.r);
        A(it.h, it.n ? { x: x - r, y: y - r, width: 2 * r, height: 2 * r, "stroke-width": w } : { cx: x, cy: y, r, "stroke-width": w });
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
  });

  // src/attach.js
  function attach(svg, opts = {}) {
    const PRIM = opts.selector || "path,rect,circle,ellipse,line,polyline,polygon,text", root = opts.root || svg;
    let ov = opts.overlay;
    if (!ov) {
      ov = mk("g", { style: "pointer-events:none" });
      svg.append(ov);
    }
    const hs = {}, on = (e, f) => {
      (hs[e] ??= []).push(f);
    }, emit = (e, d) => (hs[e] || []).forEach((f) => f(d));
    if (opts.onSelect) on("select", opts.onSelect);
    if (opts.onChange) on("change", (d) => opts.onChange(d.el, d.attr, d.src));
    let sel = null, widget = null;
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
      const old = el.getAttribute(attr);
      if (old === String(v)) return;
      el.setAttribute(attr, v);
      record(el, attr, old, String(v), src);
      emit("change", { el, attr, src });
    };
    const step = (from, to, dir) => {
      const g = from.pop();
      if (!g) return;
      (dir > 0 ? g.items : [...g.items].reverse()).forEach((i) => {
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
    const matrixFor = (el) => ov.getCTM().inverse().multiply(el.getCTM());
    function select(el) {
      if (el === sel) return;
      widget?.destroy();
      widget = null;
      ov.replaceChildren();
      sel = el;
      if (el) {
        const ctx = {
          el,
          overlay: ov,
          on,
          matrix: () => matrixFor(el),
          px: (n) => n / scale(),
          toLocal(e) {
            const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(ov.getScreenCTM().inverse()).matrixTransform(matrixFor(el).inverse());
            return [q.x, q.y];
          },
          set(a, v, src = "widget") {
            setAttr(el, a, v, src);
          }
        };
        widget = Widgets.find(el).factory(ctx);
      }
      emit("select", el);
    }
    const onClick = (e) => {
      if (ov.contains(e.target)) return;
      const t = e.target.closest?.(PRIM);
      select(t && root.contains(t) ? t : null);
    };
    if (opts.pick !== false) svg.addEventListener("click", onClick);
    return {
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
        select(null);
        svg.removeEventListener("click", onClick);
        svg.removeEventListener("pointerdown", onDown, true);
        removeEventListener("keydown", onKey);
        if (!opts.overlay) ov.remove();
      }
    };
  }
  return __toCommonJS(index_exports);
})();
