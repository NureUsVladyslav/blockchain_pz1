import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "../src/utils/hash.ts";

test('sha256: еталонні значення для "abc" та порожнього рядка', () => {
  assert.equal(
    sha256("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.equal(
    sha256(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

test("sha256: хеш від БАЙТІВ і хеш від hex-ТЕКСТУ цих байтів це різні хеші", () => {
  const bytes = Buffer.from("6162", "hex");
  assert.equal(bytes.length, 2);
  assert.equal(sha256(bytes), sha256("ab"));
  assert.notEqual(sha256(bytes), sha256("6162"));
});
