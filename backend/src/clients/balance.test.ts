import assert from 'node:assert/strict';
import test from 'node:test';
import { debitMicroIdr, rupiahToMicroIdr } from './balance';

test('converts whole-rupiah top-ups to exact micro-rupiah values', () => {
  assert.equal(rupiahToMicroIdr(75_000), '75000000000');
});

test('converts usage charges to a negative exact micro-rupiah delta', () => {
  assert.equal(debitMicroIdr('123456'), '-123456');
  assert.throws(() => debitMicroIdr('-1'), RangeError);
});

test('rejects fractional or unsafe top-up amounts', () => {
  assert.throws(() => rupiahToMicroIdr(1.5), RangeError);
  assert.throws(() => rupiahToMicroIdr(Number.MAX_SAFE_INTEGER + 1), RangeError);
});
