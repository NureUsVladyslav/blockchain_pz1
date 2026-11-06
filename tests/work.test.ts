import { test } from "node:test";
import assert from "node:assert/strict";
import { blockWork, chainWork } from "../src/core/work.ts";
import { createBlock } from "../src/core/block.ts";
import type { Block } from "../src/core/block.ts";

// Блоки з потрібною складністю (для підрахунку роботи майнінг не потрібен)
const blocksWith = (difficulties: number[]): Block[] =>
  difficulties.map((difficulty, index) =>
    createBlock({
      index,
      timestamp: index,
      previousHash: "0".repeat(64),
      difficulty,
      transactions: [],
    }),
  );

test("blockWork: 2 у степені складності, у BigInt", () => {
  assert.equal(blockWork(0), 1n);
  assert.equal(blockWork(10), 1024n);
  assert.equal(blockWork(256), 2n ** 256n); // не вміщується у звичайне число
});

test("chainWork: сума по блоках без генезис-блоку", () => {
  assert.equal(chainWork(blocksWith([99])), 0n); // лише генезис
  assert.equal(chainWork(blocksWith([99, 3, 3, 4])), 8n + 8n + 16n);
});

test('менший за довжиною ланцюг може мати більше роботи (чому не просто "найдовший")', () => {
  const longButEasy = blocksWith([1, ...Array<number>(10).fill(2)]); // 10 блоків зі складністю 2
  const shortButHard = blocksWith([1, ...Array<number>(3).fill(5)]); // 3 блоки зі складністю 5

  assert.ok(longButEasy.length > shortButHard.length);
  assert.equal(chainWork(longButEasy), 40n);
  assert.equal(chainWork(shortButHard), 96n);
  assert.ok(chainWork(shortButHard) > chainWork(longButEasy));
});
