import { isHex } from "../utils/hex.ts";
import { blockHash } from "./block.ts";
import type { Block, BlockHeader } from "./block.ts";

// Скільки нульових БІТІВ на початку хешу (хеш заданий як 64 hex-символи).
// Рахуємо по байтах: нульовий байт дає 8 бітів, перший ненульовий байт дає свої нулі і зупиняє підрахунок.
export function leadingZeroBits(hashHex: string): number {
  if (!isHex(hashHex, 32))
    throw new Error("Хеш має бути рядком із 64 hex-символів");
  let bits = 0;
  for (const byte of Buffer.from(hashHex, "hex")) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24; // clz32 рахує нулі у 32-бітному числі, а байт займає лише останні 8 бітів
    break;
  }
  return bits;
}

// Чи підходить хеш заголовка під складність, записану в самому заголовку
export function meetsDifficulty(header: BlockHeader): boolean {
  return leadingZeroBits(blockHash(header)) >= header.difficulty;
}

// Майнінг: перебираємо nonce від 0, поки хеш заголовка не підійде під складність.
export function mineBlock(block: Block): Block {
  if (block.header.difficulty > 256) {
    throw new Error("Складність не може перевищувати 256 бітів (довжина хешу)");
  }
  for (let nonce = 0; ; nonce++) {
    const header = { ...block.header, nonce };
    if (meetsDifficulty(header)) return { ...block, header };
  }
}
