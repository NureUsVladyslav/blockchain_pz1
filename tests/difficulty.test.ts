import { test } from "node:test";
import assert from "node:assert/strict";
import { nextDifficulty } from "../src/core/difficulty.ts";
import type { DifficultyParams } from "../src/core/difficulty.ts";
import type { BlockHeader } from "../src/core/block.ts";

// Маленькі параметри для тестів: K = 4, бажаний час блоку 1000 мс
const params: DifficultyParams = {
  retargetInterval: 4,
  targetBlockTimeMs: 1000,
  minDifficulty: 1,
};

// Будує заголовки ланцюга: генезис (індекс 0) і блоки з вказаними мітками часу
function headers(
  timestamps: number[],
  difficulty: number,
  genesisTimestamp = 0,
): BlockHeader[] {
  return [genesisTimestamp, ...timestamps].map((timestamp, index) => ({
    index,
    timestamp,
    previousHash: "0".repeat(64),
    merkleRoot: "0".repeat(64),
    difficulty,
    nonce: 0,
  }));
}

test("складність не змінюється, поки епоха не закінчилась", () => {
  assert.equal(nextDifficulty(headers([], 10), params), 10); // тільки генезис
  assert.equal(nextDifficulty(headers([1000, 2000], 10), params), 10);
  assert.equal(
    nextDifficulty(headers([1000, 2000, 3000, 4000], 10).slice(0, 4), params),
    10,
  );
});

test("блоки йшли швидше за бажане: складність +1", () => {
  assert.equal(
    nextDifficulty(headers([1000, 1500, 2000, 2500], 10), params),
    11,
  );
});

test("блоки йшли повільніше за бажане: складність -1", () => {
  assert.equal(
    nextDifficulty(headers([1000, 5000, 9000, 13000], 10), params),
    9,
  );
});

test("час рівно як бажаний: складність не змінюється", () => {
  assert.equal(
    nextDifficulty(headers([1000, 2000, 3000, 4000], 10), params),
    10,
  );
});

test("усередині нової епохи складність знову не змінюється", () => {
  const chain = headers([1000, 1500, 2000, 2500, 3000], 11);
  assert.equal(nextDifficulty(chain, params), 11);
});

test("складність не падає нижче мінімуму", () => {
  assert.equal(
    nextDifficulty(headers([1000, 5000, 9000, 13000], 1), params),
    1,
  );
});

test("мітка часу генезис-блоку не впливає на першу підстройку", () => {
  const fast = [
    1_700_000_001_000, 1_700_000_001_500, 1_700_000_002_000, 1_700_000_002_500,
  ];
  assert.equal(nextDifficulty(headers(fast, 10, 0), params), 11);
});

test("некоректні параметри та порожній ланцюг викликають помилку", () => {
  assert.throws(
    () => nextDifficulty(headers([], 10), { ...params, retargetInterval: 1 }),
    /не менше 2/,
  );
  assert.throws(() => nextDifficulty([], params), /генезис/);
});
