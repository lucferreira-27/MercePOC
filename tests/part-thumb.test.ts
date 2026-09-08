import test from 'node:test';
import assert from 'node:assert/strict';
import { framePart, thumbKey, renderPartThumb } from '../lib/part-thumb';

void test('thumbnails frame any part size looking at the origin', () => {
  const frame = framePart([764, 18, 344]);
  assert.equal(frame.dist, 764 * 2.1);
  assert.ok(frame.eye.every((v) => v > 0));
  assert.ok(frame.near > 0 && frame.far > frame.dist * 2);
  const halfAngle = Math.atan(764 / 2 / frame.dist);
  assert.ok(halfAngle < (30 / 2) * (Math.PI / 180));
  assert.notEqual(thumbKey([1, 2, 3], '#fff'), thumbKey([1, 2, 3], '#000'));
  assert.notEqual(thumbKey([1, 2, 3], '#fff'), thumbKey([1, 2, 4], '#fff'));
});

void test('thumbnail rendering degrades to null without WebGL', () => {
  assert.equal(renderPartThumb([10, 10, 10], '#fff'), null);
});
