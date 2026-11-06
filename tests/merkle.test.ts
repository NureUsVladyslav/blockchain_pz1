import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { merkleRoot } from "../src/core/merkle.ts";
import { sha256 } from "../src/utils/hash.ts";

// Незалежний ручний підрахунок: SHA-256 від склеєних байтів двох хешів
const pair = (a: string, b: string): string =>
  createHash("sha256")
    .update(Buffer.concat([Buffer.from(a, "hex"), Buffer.from(b, "hex")]))
    .digest("hex");

const leaves = ["a", "b", "c", "d", "e"].map((text) => sha256(text));

test("корінь Меркла для парної кількості листків (4)", () => {
  const [a, b, c, d] = leaves as [string, string, string, string];
  const expected = pair(pair(a, b), pair(c, d));
  assert.equal(merkleRoot([a, b, c, d]), expected);
});

test("корінь Меркла для непарної кількості листків (3): останній дублюється", () => {
  const [a, b, c] = leaves as [string, string, string];
  const expected = pair(pair(a, b), pair(c, c));
  assert.equal(merkleRoot([a, b, c]), expected);
  // Те саме, що явно записати останній листок двічі
  assert.equal(merkleRoot([a, b, c]), merkleRoot([a, b, c, c]));
});

test("корінь Меркла для непарної кількості на кількох рівнях (5)", () => {
  const [a, b, c, d, e] = leaves as [string, string, string, string, string];
  // рівень 1: ab, cd, ee; рівень 2: abcd, eeee; корінь
  const expected = pair(
    pair(pair(a, b), pair(c, d)),
    pair(pair(e, e), pair(e, e)),
  );
  assert.equal(merkleRoot([a, b, c, d, e]), expected);
});

test("один листок: корінь дорівнює самому листку; порожній список: SHA-256 порожніх даних", () => {
  const [a] = leaves as [string];
  assert.equal(merkleRoot([a]), a);
  assert.equal(merkleRoot([]), sha256(""));
});

test("зміна або перестановка листків змінює корінь", () => {
  const [a, b, c, d] = leaves as [string, string, string, string];
  const root = merkleRoot([a, b, c, d]);
  assert.notEqual(merkleRoot([a, b, c, sha256("інша транзакція")]), root);
  assert.notEqual(merkleRoot([b, a, c, d]), root);
});

test("листок не у форматі хешу викликає помилку", () => {
  assert.throws(() => merkleRoot(["не хеш"]), /листок/i);
});
