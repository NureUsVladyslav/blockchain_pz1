import { blockHash, checkHeader } from "../core/block.ts";
import { createGenesisBlock } from "../core/blockchain.ts";
import { DEFAULT_PARAMS, nextDifficulty } from "../core/difficulty.ts";
import { verifyMerkleProof } from "../core/merkle.ts";
import { meetsDifficulty } from "../core/pow.ts";
import { INITIAL_DIFFICULTY } from "../config.ts";
import { isHex } from "../utils/hex.ts";
import { isObject } from "../utils/object.ts";
import type { BlockHeader } from "../core/block.ts";
import type { ChainOptions } from "../core/blockchain.ts";
import type { DifficultyParams } from "../core/difficulty.ts";
import type { CheckResult } from "../core/transaction.ts";

type Failure = { ok: false; reason: string };
const fail = (reason: string): Failure => ({ ok: false, reason });

// "Легкий" клієнт: зберігає лише заголовки блоків (без жодної транзакції) і за допомогою доказу Меркла
// перевіряє, що транзакція справді входить у блок. Вузлу, від якого отримує дані, не довіряє:
// заголовки перевіряє сам (зв'язок, складність, Proof of Work), а доказ звіряє з власною копією заголовка.
export class LightClient {
  #params: DifficultyParams;
  #headers: BlockHeader[];

  constructor(options: ChainOptions = {}) {
    this.#params = options.difficultyParams ?? DEFAULT_PARAMS;
    this.#headers = [
      createGenesisBlock(options.genesisDifficulty ?? INITIAL_DIFFICULTY)
        .header,
    ];
  }

  get headers(): readonly BlockHeader[] {
    return this.#headers;
  }

  // Приймає заголовки від вузла і перевіряє їх усі. Якщо хоч один не пройшов, нічого не змінюється.
  loadHeaders(value: unknown): CheckResult {
    if (!Array.isArray(value) || value.length === 0)
      return fail("Очікується непорожній масив заголовків");

    const genesis = this.#headers[0] as BlockHeader;
    const first = checkHeader(value[0]);
    if (!first.ok) return fail(`Заголовок №0: ${first.reason}`);
    if (blockHash(value[0] as BlockHeader) !== blockHash(genesis)) {
      return fail("Заголовок №0: генезис-блок відрізняється від нашого");
    }

    const accepted: BlockHeader[] = [genesis];
    for (let i = 1; i < value.length; i++) {
      const check = checkHeader(value[i]);
      if (!check.ok) return fail(`Заголовок №${i}: ${check.reason}`);
      const header = value[i] as BlockHeader;
      const previous = accepted[i - 1] as BlockHeader;

      if (header.index !== i)
        return fail(`Заголовок №${i}: неправильний номер ${header.index}`);
      if (header.previousHash !== blockHash(previous))
        return fail(
          `Заголовок №${i}: previousHash не збігається з хешем попереднього`,
        );
      const expected = nextDifficulty(accepted, this.#params); // для цього потрібні лише заголовки
      if (header.difficulty !== expected)
        return fail(
          `Заголовок №${i}: неправильна складність (очікується ${expected})`,
        );
      if (!meetsDifficulty(header))
        return fail(
          `Заголовок №${i}: хеш не відповідає складності (Proof of Work)`,
        );
      accepted.push(header);
    }
    this.#headers = accepted;
    return { ok: true };
  }

  // Перевіряє відповідь вузла з доказом: транзакція з id txId входить у блок, чий заголовок ми вже маємо.
  // Корінь Меркла береться з НАШОЇ копії заголовка, а не з відповіді вузла.
  verifyInclusion(txId: string, response: unknown): CheckResult {
    if (!isHex(txId, 32))
      return fail(
        "Ідентифікатор транзакції має бути рядком із 64 hex-символів",
      );
    if (
      !isObject(response) ||
      typeof response.blockIndex !== "number" ||
      response.txId !== txId
    ) {
      return fail("Відповідь вузла має неправильний формат");
    }
    const header = this.#headers[response.blockIndex];
    if (header === undefined)
      return fail(
        "У світлого клієнта немає заголовка цього блоку: спершу завантажте заголовки",
      );

    if (!verifyMerkleProof(txId, response.proof, header.merkleRoot)) {
      return fail("Доказ не збігається з коренем Меркла в заголовку блоку");
    }
    return { ok: true };
  }
}
