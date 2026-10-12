import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePath, serPath, arcGeom, twins, segInfo, startTangent, endTangent } from '../../src/path-math.js';
import { nodeTypeAny, setNodeTypeAt, setNodeTypes, arcToCubic1, arcTangentThrough, sides } from '../../src/node-type.js';

const P = d => parsePath(d), S = s => serPath(s), set = (d, j, t) => { const r = setNodeTypeAt(P(d), j, t); return r && r.segs; };
const T = (segs, j) => nodeTypeAny(segs, j);
const un = v => { const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l]; };
const avg = (u, v) => un([u[0] + v[0], u[1] + v[1]]);                            // the handles lie along the average of the two tangents
const at = (n, t, L) => [n[0] + t[0] * L, n[1] + t[1] * L];
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);
const nearPt = (p, q, eps = 1e-6) => { near(p[0], q[0], eps); near(p[1], q[1], eps); };

test('nodeTypeAny: any node with a segment on both sides has a type; tangents decide it where a side has no handle', () => {
  assert.equal(T(P('M0 0 L10 0 L20 0'), 1), 'smooth');                         // a straight run
  assert.equal(T(P('M0 0 L10 0 L10 10'), 1), 'corner');
  assert.equal(T(P('M0 0 L10 0'), 0), null); assert.equal(T(P('M0 0 L10 0'), 1), null);   // the ends of an open path
  assert.equal(T(P('M0 0 C0 10 20 20 30 20 L60 20'), 1), 'smooth');
  assert.equal(T(P('M0 0 C0 10 20 20 30 20 C40 20 50 30 60 30'), 1), 'symmetric'); // two beziers: as nodeType
  assert.equal(T(P('M0 0 L40 0 L40 40 Z'), 3 - 1), 'corner');                    // the Z's line is a side
  assert.equal(T(P('M0 0 L40 0 L40 40 Z'), 0), 'corner');
});

test('1/4 bezier + line: the line becomes a bezier of the bezier\'s kind; both handles on the averaged tangent, each keeping its length (the new one half its line), or equal for symmetric', () => {
  const C = 'M0 0 C0 10 20 20 30 20 L60 50', n = [30, 20], t = avg([1, 0], un([30, 30])), half = Math.hypot(30, 30) / 2;
  let r = set(C, 1, 'smooth'); assert.equal(r[2].t, 'C'); nearPt(r[1].pts[1], at(n, t, -10)); nearPt(r[2].pts[0], at(n, t, half)); assert.equal(T(r, 1), 'smooth');
  r = set(C, 1, 'symmetric'); nearPt(r[1].pts[1], at(n, t, -10)); nearPt(r[2].pts[0], at(n, t, 10)); assert.equal(T(r, 1), 'symmetric'); assert.ok(r[2].sm);
  const Q = 'M0 0 Q20 20 30 20 L60 50';
  r = set(Q, 1, 'smooth'); assert.deepEqual([r[1].t, r[2].t], ['Q', 'Q']); nearPt(r[1].pts[0], at(n, t, -10)); nearPt(r[2].pts[0], at(n, t, half)); assert.equal(T(r, 1), 'smooth');
  r = set(Q, 1, 'symmetric'); nearPt(r[2].pts[0], at(n, t, 10)); assert.equal(T(r, 1), 'symmetric');
  // line + bezier is the same with the order swapped
  const L = 'M0 0 L30 0 C40 10 50 20 60 20', m = [30, 0], u = avg([1, 0], un([10, 10]));
  r = set(L, 1, 'smooth'); assert.equal(r[1].t, 'C'); nearPt(r[1].pts[1], at(m, u, -15)); nearPt(r[2].pts[0], at(m, u, Math.hypot(10, 10))); assert.equal(T(r, 1), 'smooth');
  r = set(L, 1, 'symmetric'); assert.equal(T(r, 1), 'symmetric'); nearPt(r[1].pts[1], at(m, u, -Math.hypot(10, 10)));
});

test('the quadratic rule: a quadratic would turn the tangent at its far end, so when that node is smooth the line becomes a cubic instead', () => {
  const Q = 'M0 0 Q20 20 30 20 L60 50 L90 80';                              // the node at 60,50 is a straight run: smooth
  assert.equal(T(P(Q), 2), 'smooth');
  const r = set(Q, 1, 'smooth');
  assert.equal(r[2].t, 'C'); assert.equal(T(r, 1), 'smooth'); assert.equal(T(r, 2), 'smooth'); // still smooth at the far end
  assert.equal(set('M0 0 Q20 20 30 20 L60 50 L90 50', 1, 'smooth')[2].t, 'Q');   // a corner there: nothing to keep, a quadratic will do
  const r2 = set('M0 0 L30 20 Q50 50 60 50 L60 90', 2, 'smooth');                // a quadratic that has to give way: it turns into a cubic when its far end is smooth
  assert.ok(r2);
});

test('2/5 arc + line: smooth makes a quadratic along the arc\'s tangent; symmetric makes a circular arc tangent there (radii can\'t be copied)', () => {
  const D = 'M0 0 A20 20 0 0 1 20 20 L60 20';
  assert.equal(T(P(D), 1), 'corner');
  let r = set(D, 1, 'smooth'); assert.equal(r[2].t, 'Q'); assert.equal(T(r, 1), 'smooth');
  r = set(D, 1, 'symmetric'); assert.equal(r[2].t, 'A'); assert.equal(T(r, 1), 'smooth');
  nearPt(r[2].pts[0], [60, 20]);                                               // still ends where the line did
  const g = arcGeom([20, 20], [60, 20], ...r[2].arc); assert.ok(g); near(r[2].arc[0], r[2].arc[1]);
  const E = 'M0 10 L30 0 A20 20 0 0 1 50 20';                                   // line + arc
  r = set(E, 1, 'symmetric'); assert.equal(r[1].t, 'A'); assert.equal(T(r, 1), 'smooth'); nearPt(r[1].pts[0], [30, 0]);
  assert.ok(arcGeom([0, 10], [30, 0], ...r[1].arc));
  r = set(E, 1, 'smooth'); assert.equal(r[1].t, 'Q'); assert.equal(T(r, 1), 'smooth');
  assert.equal(set('M0 0 A20 20 0 0 1 20 20 L20 40', 1, 'symmetric'), null);   // the line already runs along the tangent: no circle fits
});

test('3 line + line: both become cubics along the average of the two directions; smooth gives each handle half its line, symmetric half the average', () => {
  const D = 'M0 0 L30 0 L30 60', n = [30, 0], t = avg([1, 0], [0, 1]);             // the lines are 30 and 60 long
  let r = set(D, 1, 'smooth'); assert.deepEqual([r[1].t, r[2].t], ['C', 'C']); assert.equal(T(r, 1), 'smooth');
  nearPt(r[1].pts[1], at(n, t, -15)); nearPt(r[2].pts[0], at(n, t, 30));
  r = set(D, 1, 'symmetric'); assert.equal(T(r, 1), 'symmetric'); assert.ok(r[2].sm);
  nearPt(r[1].pts[1], at(n, t, -22.5)); nearPt(r[2].pts[0], at(n, t, 22.5));          // half the average of 30 and 60
});

test('6/7 arc + bezier: smooth swings the bezier\'s handle onto the arc\'s tangent; symmetric makes the arc a single bezier and both go along the averaged tangent', () => {
  const D = 'M0 0 A20 20 0 0 1 20 20 C30 30 40 40 50 40', n = [20, 20];
  let r = set(D, 1, 'smooth'); assert.equal(r[1].t, 'A'); assert.equal(T(r, 1), 'smooth');
  near(Math.hypot(r[2].pts[0][0] - 20, r[2].pts[0][1] - 20), Math.hypot(10, 10), 1e-9);   // the handle keeps its length
  const t = avg([0, 1], un([10, 10]));                                                    // the arc ends heading straight down
  r = set(D, 1, 'symmetric'); assert.equal(r.length, 3); assert.deepEqual([r[1].t, r[2].t], ['C', 'C']); assert.equal(T(r, 1), 'symmetric');
  nearPt(r[1].pts[1], at(n, t, -Math.hypot(10, 10))); nearPt(r[2].pts[0], at(n, t, Math.hypot(10, 10)));
  const E = 'M0 0 C10 -10 20 -10 30 0 A20 20 0 0 1 50 20';                       // bezier + arc
  r = set(E, 1, 'smooth'); assert.equal(r[2].t, 'A'); assert.equal(T(r, 1), 'smooth');
  r = set(E, 1, 'symmetric'); assert.equal(r.length, 3); assert.equal(r[2].t, 'C'); assert.equal(T(r, 1), 'symmetric');
  const Q = 'M0 0 A20 20 0 0 1 20 20 Q30 30 50 40';                              // arc + quadratic: the arc becomes a quadratic
  r = set(Q, 1, 'symmetric'); assert.equal(r[1].t, 'Q'); assert.equal(r.length, 3); nearPt(r[1].pts[0], at(n, t, -Math.hypot(10, 10)));
});

test('arc + arc: each becomes one best-fit cubic (no extra nodes), then as two beziers', () => {
  const D = 'M0 0 A20 20 0 0 1 20 20 A15 15 0 0 0 40 40';
  for (const t of ['smooth', 'symmetric']) { const r = set(D, 1, t); assert.equal(r.length, 3); assert.deepEqual([r[1].t, r[2].t], ['C', 'C']); assert.equal(T(r, 1), t); }
  const big = set('M0 0 A20 20 0 1 1 20 20 A20 20 0 0 0 40 40', 1, 'smooth'); assert.equal(big.length, 3); // a three quarter turn arc is still one segment
});

test('a closing line that draws something becomes an explicit segment first: one segment more, and the ends join', () => {
  const D = 'M0 0 L40 0 L40 40 Z';
  const r = setNodeTypeAt(P(D), 2, 'smooth');
  assert.equal(r.ins, 3); assert.equal(r.segs.length, 5); assert.equal(r.segs[4].t, 'Z');
  assert.deepEqual(twins(r.segs), [3, -1, -1, 0, -1]);                          // the start and the end are one joined node now
  assert.deepEqual([r.segs[2].t, r.segs[3].t], ['C', 'C']);
  assert.equal(T(r.segs, 2), 'smooth');
  const s = setNodeTypeAt(P(D), 0, 'smooth');                                    // from the other end of the closing line
  assert.equal(s.ins, 3); assert.equal(T(s.segs, 0), 'smooth');
  // the sel mapping of setNodeTypes follows the insertions
  const m = setNodeTypes(P('M0 0 L40 0 L40 40 Z M100 100 L140 100 L140 140 Z'), [2, 6], 'smooth');
  assert.deepEqual(m.sel, [2, 7]);                                              // (the second subpath's node moves up by the one segment added before it)
});

test('a node with one segment on both sides (a cubic back to its own start) smooths against itself: a closed line, as asked', () => {
  const D = 'M10 10 C30 0 30 30 10 10';
  assert.equal(T(P(D), 0), 'corner');
  let r = set(D, 0, 'smooth'); assert.equal(T(r, 0), 'smooth');
  const A = r[1].pts[1], B = r[1].pts[0]; near((B[0] - 10) * (A[1] - 10) - (B[1] - 10) * (A[0] - 10), 0, 1e-9);
  r = set(D, 0, 'symmetric'); assert.equal(T(r, 0), 'symmetric'); nearPt(r[1].pts[0], [10 - (r[1].pts[1][0] - 10), 10 - (r[1].pts[1][1] - 10)]);
  const Q = set('M10 10 Q40 40 10 10', 0, 'smooth'); assert.equal(Q[1].t, 'C'); assert.ok(['smooth', 'symmetric'].includes(T(Q, 0)));   // (a quadratic's handles are the same length: it comes out symmetric)
});

test('corner is the old behaviour: it breaks an S link and does nothing where there is no link', () => {
  const D = 'M0 0 C0 10 20 20 30 20 S60 0 70 0';
  assert.equal(S(set(D, 1, 'corner')), 'M0 0 C0 10 20 20 30 20 C40 20 60 0 70 0');
  assert.equal(setNodeTypeAt(P('M0 0 L30 0 L30 30'), 1, 'corner'), null);
  assert.equal(set('M0 0 L30 0', 0, 'smooth'), null);                            // an end has no other side
});

test('arcToCubic1: exact (to 3e-4) up to a quarter turn; never more than one segment however big the arc', () => {
  const c = arcToCubic1([20, 0], [0, 20], [20, 20, 0, 0, 0]);                   // a quarter circle about the origin
  assert.equal(c.t, 'C');
  const mid = [0.125 * 20 + 0.375 * c.pts[0][0] + 0.375 * c.pts[1][0] + 0.125 * 0, 0.125 * 0 + 0.375 * c.pts[0][1] + 0.375 * c.pts[1][1] + 0.125 * 20];
  const g = arcGeom([20, 0], [0, 20], 20, 20, 0, 0, 0); near(Math.hypot(mid[0] - g.cx, mid[1] - g.cy), 20, 20 * 3e-4);
  assert.ok(arcToCubic1([0, 0], [20, 20], [20, 20, 0, 1, 1]));
});

test('arcTangentThrough: the circle that leaves p0 along t0 through p1', () => {
  const r = arcTangentThrough([0, 0], [1, 0], [20, 20]);                        // heading +x, ends at (20,20): a quarter turn of radius 20
  near(r.R, 20); assert.equal(r.sweep, 1); assert.equal(r.large, 0);
  const s = [{ t: 'M', pts: [[0, 0]] }, { t: 'A', arc: [r.R, r.R, 0, r.large, r.sweep], pts: [[20, 20]] }];
  const t = startTangent(s, 1, segInfo(s)); nearPt(t, [1, 0], 1e-6);
  assert.equal(arcTangentThrough([0, 0], [1, 0], [20, 0]), null);              // on the tangent line
  const w = arcTangentThrough([0, 0], [1, 0], [-20, 20]);                       // behind: the long way round
  assert.equal(w.large, 1);
});

test('sides: the segments on each side of a node, with joined nodes and closing lines', () => {
  assert.deepEqual(sides(P('M0 0 L10 0 L10 10'), 1), { a: 1, b: 2, m: 0, z: -1 });
  const J = P('M50 100 C50 50 150 50 150 100 C150 150 50 150 50 100 Z');
  assert.deepEqual([sides(J, 0).a, sides(J, 0).b, sides(J, 2).a, sides(J, 2).b], [2, 1, 2, 1]);
  const Zl = P('M0 0 L40 0 L40 40 Z');
  assert.equal(sides(Zl, 2).b, 3); assert.equal(sides(Zl, 0).a, 3); assert.equal(sides(Zl, 0).b, 1);
});

/* a handle pulled right into its node (what clicking, not dragging, a new end leaves): the other handle is the anchor and the retracted one gives way */
/* a handle pulled right into its node (what clicking, not dragging, a new end leaves) has nothing to follow: it gets half the distance to the node at the
   other end of its segment (smooth); symmetric uses the length of the other handle if there is one, else half the average of the two distances */
test('retracted handles: the node ends up with handles to drag, on the averaged tangent', () => {
  const n = [30, 20];
  const A = 'M0 0 C0 10 30 20 30 20 C40 20 50 30 60 30', tA = avg(un([30, 10]), [1, 0]);   // the incoming handle is retracted; the outgoing one is 10 long
  assert.equal(T(P(A), 1), 'corner');
  let r = set(A, 1, 'smooth'); nearPt(r[1].pts[1], at(n, tA, -Math.hypot(30, 20) / 2)); nearPt(r[2].pts[0], at(n, tA, 10)); assert.equal(T(r, 1), 'smooth');
  r = set(A, 1, 'symmetric'); nearPt(r[1].pts[1], at(n, tA, -10)); nearPt(r[2].pts[0], at(n, tA, 10)); assert.equal(T(r, 1), 'symmetric'); assert.ok(r[2].sm);
  const B = 'M0 0 C0 10 20 20 30 20 C30 20 50 30 60 30', tB = avg([1, 0], un([20, 10]));  // the outgoing handle is retracted
  r = set(B, 1, 'smooth'); nearPt(r[1].pts[1], at(n, tB, -10)); nearPt(r[2].pts[0], at(n, tB, Math.hypot(30, 10) / 2)); assert.equal(T(r, 1), 'smooth');
  r = set(B, 1, 'symmetric'); nearPt(r[2].pts[0], at(n, tB, 10)); assert.equal(T(r, 1), 'symmetric');
  // both retracted: the node a click made in the middle of a path
  const X = 'M0 0 C0 10 30 20 30 20 C30 20 50 30 60 30', tX = avg(un([30, 10]), un([20, 10])), da = Math.hypot(30, 20) / 2, db = Math.hypot(30, 10) / 2;
  r = set(X, 1, 'smooth'); nearPt(r[1].pts[1], at(n, tX, -da)); nearPt(r[2].pts[0], at(n, tX, db)); assert.equal(T(r, 1), 'smooth');
  r = set(X, 1, 'symmetric'); nearPt(r[1].pts[1], at(n, tX, -(da + db) / 2)); nearPt(r[2].pts[0], at(n, tX, (da + db) / 2)); assert.equal(T(r, 1), 'symmetric');
});

test('retracted handles on a quadratic, beside a line, and beside an arc', () => {
  const n = [30, 20], t = avg(un([30, 20]), [1, 0]);
  const Q = set('M0 0 Q30 20 30 20 Q40 20 60 30', 1, 'smooth'); assert.deepEqual([Q[1].t, Q[2].t], ['Q', 'Q']);
  nearPt(Q[1].pts[0], at(n, t, -Math.hypot(30, 20) / 2)); nearPt(Q[2].pts[0], at(n, t, 10));
  // a line beside a retracted bezier handle: nothing to follow, so both handles are half their segments' length
  const L = 'M0 0 L30 0 C30 0 50 20 60 20', m = [30, 0], u = avg([1, 0], un([20, 20])), da = 15, db = Math.hypot(30, 20) / 2;
  let r = set(L, 1, 'smooth'); assert.equal(r[1].t, 'C'); nearPt(r[1].pts[1], at(m, u, -da)); nearPt(r[2].pts[0], at(m, u, db)); assert.equal(T(r, 1), 'smooth');
  r = set(L, 1, 'symmetric'); nearPt(r[2].pts[0], at(m, u, (da + db) / 2)); assert.equal(T(r, 1), 'symmetric');
  // an arc, then a bezier with its handle retracted: symmetric turns the arc into a cubic, and both get handles
  r = set('M0 0 A20 20 0 0 1 20 20 C20 20 30 40 50 40', 1, 'symmetric');
  assert.equal(r[1].t, 'C'); assert.equal(r.length, 3); assert.ok(Math.hypot(r[2].pts[0][0] - 20, r[2].pts[0][1] - 20) > 1); assert.equal(T(r, 1), 'symmetric');
  // a node placed in the middle of a straight run by clicking: it is smooth already (nothing to be done to the tangent) but gets handles
  r = set('M0 0 L30 0 L60 0', 1, 'smooth'); assert.deepEqual([r[1].t, r[2].t], ['C', 'C']); nearPt(r[1].pts[1], [15, 0]); nearPt(r[2].pts[0], [45, 0]);
});
