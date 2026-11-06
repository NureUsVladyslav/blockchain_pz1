import { test } from "node:test";
import assert from "node:assert/strict";
import {
  merkleProof,
  merkleRoot,
  verifyMerkleProof,
} from "../src/core/merkle.ts";
import { sha256 } from "../src/utils/hash.ts";

const leavesOf = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => sha256(`tx${i}`));

test("доказ Меркла проходить для кожного листка при парній і непарній кількості листків (1..9)", () => {
  for (let count = 1; count <= 9; count++) {
    const leaves = leavesOf(count);
    const root = merkleRoot(leaves);
    for (let i = 0; i < count; i++) {
      assert.equal(
        verifyMerkleProof(leaves[i] as string, merkleProof(leaves, i), root),
        true,
        `листків ${count}, номер ${i}`,
      );
    }
  }
});

test("підроблений доказ і сміття замість доказу не проходять перевірку", () => {
  const leaves = leavesOf(4);
  const root = merkleRoot(leaves);
  const proof = merkleProof(leaves, 0);

  assert.equal(
    verifyMerkleProof(sha256("чужа транзакція"), proof, root),
    false,
  ); // інший листок
  assert.equal(
    verifyMerkleProof(leaves[0] as string, proof, sha256("інший корінь")),
    false,
  ); // інший корінь
  assert.equal(
    verifyMerkleProof(leaves[0] as string, proof.slice(1), root),
    false,
  ); // обрізаний доказ
  for (const garbage of [
    null,
    "abc",
    {},
    [{}],
    [{ hash: "abc", position: "left" }],
  ]) {
    assert.equal(verifyMerkleProof(leaves[0] as string, garbage, root), false); // і без винятків
  }
});
