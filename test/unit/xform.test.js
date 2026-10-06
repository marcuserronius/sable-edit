import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtTransform } from '../../src/xform.js';

const M = (a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) => ({ a, b, c, d, e, f });

test('fmtTransform: identity -> null (attribute removed)', () => assert.equal(fmtTransform(M()), null));
test('fmtTransform: pure translation', () => assert.equal(fmtTransform(M(1, 0, 0, 1, 5, -2.5)), 'translate(5 -2.5)'));
test('fmtTransform: uniform and non-uniform scale', () => {
  assert.equal(fmtTransform(M(2, 0, 0, 2)), 'scale(2)');
  assert.equal(fmtTransform(M(2, 0, 0, 0.5, 10, 0)), 'translate(10 0) scale(2 0.5)');
});
test('fmtTransform: rotation about the origin, with and without translation', () => {
  const t = 30 * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  assert.equal(fmtTransform(M(c, s, -s, c)), 'rotate(30)');
  assert.equal(fmtTransform(M(c, s, -s, c, 7, 8)), 'translate(7 8) rotate(30)');
});
test('fmtTransform: skew and mixed fall back to matrix()', () => {
  assert.equal(fmtTransform(M(1, 0, 0.5, 1, -10, 0)), 'matrix(1 0 0.5 1 -10 0)');
  assert.equal(fmtTransform(M(2, 1, -1, 2)), 'matrix(2 1 -1 2 0 0)');
});
test('fmtTransform: rounds floating-point noise', () => {
  assert.equal(fmtTransform(M(1 + 1e-12, 1e-12, -1e-12, 1, 1e-12, 0)), null);
});
