import type { Block } from "./block.ts";

// Робота одного блоку: у середньому стільки хешів треба перебрати, щоб знайти блок
// зі складністю difficulty (кількість нульових бітів).
export function blockWork(difficulty: number): bigint {
  return 2n ** BigInt(difficulty);
}

// Сумарна робота ланцюга: сума по всіх намайнених блоках.
// Генезис-блок не майнився і однаковий у всіх вузлів, тому його не рахуємо.
export function chainWork(blocks: readonly Block[]): bigint {
  let total = 0n;
  for (const block of blocks.slice(1))
    total += blockWork(block.header.difficulty);
  return total;
}
