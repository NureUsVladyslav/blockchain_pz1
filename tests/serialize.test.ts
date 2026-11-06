import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalize } from "../src/utils/serialize.ts";

test("canonicalize: порядок ключів не впливає на результат", () => {
  assert.equal(canonicalize({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalize({ a: 2, b: 1 }), '{"a":2,"b":1}');
});

test("canonicalize: вкладені об'єкти сортуються, порядок масиву зберігається", () => {
  assert.equal(
    canonicalize({ z: [3, 1, 2], a: { y: 1, x: 2 } }),
    '{"a":{"x":2,"y":1},"z":[3,1,2]}',
  );
});

test("canonicalize: дробові та некоректні числа відхиляються", () => {
  assert.throws(() => canonicalize(1.5), /ціле/);
  assert.throws(() => canonicalize(Number.NaN), /ціле/);
  assert.throws(() => canonicalize(Infinity), /ціле/);
});

test("canonicalize: undefined у даних викликає помилку, а не зникає мовчки", () => {
  assert.throws(() => canonicalize({ a: undefined }), /Не можна серіалізувати/);
});
