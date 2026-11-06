import { GENESIS_TIMESTAMP, INITIAL_DIFFICULTY } from "../config.ts";
import {
  blockHash,
  blockTransactionId,
  createBlock,
  verifyBlockStructure,
} from "./block.ts";
import { nextDifficulty, DEFAULT_PARAMS } from "./difficulty.ts";
import { meetsDifficulty } from "./pow.ts";
import { transactionId, verifyTransaction } from "./transaction.ts";
import type { Block } from "./block.ts";
import type { DifficultyParams } from "./difficulty.ts";
import type { ChainView } from "./mempool.ts";
import type { RewardTransaction } from "./reward.ts";
import type { BlockHeader } from "./block.ts";
import type { CheckResult, Transaction } from "./transaction.ts";
import { chainWork } from "./work.ts";

type Failure = { ok: false; reason: string };
const fail = (reason: string): Failure => ({ ok: false, reason });

export interface ChainOptions {
  genesisDifficulty?: number; // складність генезис-блоку (у всіх вузлів має бути однакова)
  difficultyParams?: DifficultyParams; // параметри підстройки складності (K, цільовий час, мінімум)
}

export type ChainLoadResult =
  | { ok: true; chain: Blockchain }
  | { ok: false; reason: string };

// Зміни, які блок вносить у стан: зміна балансів і лічильників nonce
interface Effects {
  balance: Map<string, number>;
  nonces: Map<string, number>;
}

const newEffects = (): Effects => ({ balance: new Map(), nonces: new Map() });

// Генезис-блок: однаковий у всіх вузлів, бо збирається лише з констант. Не майниться.
export function createGenesisBlock(difficulty: number): Block {
  return createBlock({
    index: 0,
    timestamp: GENESIS_TIMESTAMP,
    previousHash: "0".repeat(64),
    difficulty,
    transactions: [],
    nonce: 0,
  });
}

// Ланцюг блоків разом зі станом, який з нього випливає (баланси, лічильники nonce, id транзакцій).
export class Blockchain implements ChainView {
  #blocks: Block[];
  #params: DifficultyParams;
  #balances = new Map<string, number>();
  #nonceCounts = new Map<string, number>();
  #txIds = new Set<string>();

  constructor(options: ChainOptions = {}) {
    this.#params = options.difficultyParams ?? DEFAULT_PARAMS;
    this.#blocks = [
      createGenesisBlock(options.genesisDifficulty ?? INITIAL_DIFFICULTY),
    ];
  }

  get blocks(): readonly Block[] {
    return this.#blocks;
  }

  get length(): number {
    return this.#blocks.length;
  }

  get lastBlock(): Block {
    return this.#blocks[this.#blocks.length - 1] as Block;
  }
  // Сумарна робота ланцюга
  get totalWork(): bigint {
    return chainWork(this.#blocks);
  }

  getBalance(address: string): number {
    return this.#balances.get(address) ?? 0;
  }

  getNextNonce(address: string): number {
    return this.#nonceCounts.get(address) ?? 0;
  }

  hasTransaction(id: string): boolean {
    return this.#txIds.has(id);
  }
  // Знаходить транзакцію (звичайну чи винагороду) за id: блок і її місце в списку блоку.
  // Іде від кінця ланцюга, бо нові транзакції шукають частіше.
  findTransaction(id: string): { block: Block; index: number } | null {
    for (let b = this.#blocks.length - 1; b >= 1; b--) {
      const block = this.#blocks[b] as Block;
      const index = block.transactions.findIndex(
        (tx) => blockTransactionId(tx) === id,
      );
      if (index !== -1) return { block, index };
    }
    return null;
  }
  // Складність, яка має бути в наступного блоку
  getNextDifficulty(): number {
    const headers: BlockHeader[] = this.#blocks.map((block) => block.header);
    return nextDifficulty(headers, this.#params);
  }

  // Перевіряє одну звичайну транзакцію з урахуванням змін, які вже вніс цей же блок
  #checkTransaction(value: unknown, fx: Effects): CheckResult {
    const verified = verifyTransaction(value);
    if (!verified.ok) return verified;
    const tx = value as Transaction;

    const expectedNonce =
      this.getNextNonce(tx.from) + (fx.nonces.get(tx.from) ?? 0);
    if (tx.nonce !== expectedNonce) {
      return fail(
        `Неправильний nonce: очікується ${expectedNonce}, отримано ${tx.nonce}`,
      );
    }

    const available = this.getBalance(tx.from) + (fx.balance.get(tx.from) ?? 0);
    const needed = tx.amount + tx.fee;
    if (available < needed) {
      return fail(
        `Недостатньо коштів: доступно ${available}, потрібно ${needed}`,
      );
    }

    if (this.#txIds.has(transactionId(tx))) {
      return fail("Така транзакція вже є в ланцюгу");
    }
    return { ok: true };
  }

  #applyTransaction(tx: Transaction, fx: Effects): void {
    fx.balance.set(
      tx.from,
      (fx.balance.get(tx.from) ?? 0) - (tx.amount + tx.fee),
    );
    fx.balance.set(tx.to, (fx.balance.get(tx.to) ?? 0) + tx.amount);
    fx.nonces.set(tx.from, (fx.nonces.get(tx.from) ?? 0) + 1);
  }

  // Вибирає з кандидатів ті звичайні транзакції, які можна покласти в наступний блок (за порядком).
  // Транзакції, що стали недійсними (наприклад, конфліктують з уже доданим блоком), пропускаються.
  selectTransactions(candidates: Transaction[]): Transaction[] {
    const fx = newEffects();
    const selected: Transaction[] = [];
    for (const tx of candidates) {
      if (this.#checkTransaction(tx, fx).ok) {
        this.#applyTransaction(tx, fx);
        selected.push(tx);
      }
    }
    return selected;
  }

  // Усі перевірки блоку відносно поточного ланцюга. Нічого не змінює.
  #evaluate(
    value: unknown,
  ): Failure | { ok: true; effects: Effects; regularIds: string[] } {
    // 1. Власна цілісність блоку: форма, винагорода, формат транзакцій, дублікати, корінь Меркла
    const structure = verifyBlockStructure(value);
    if (!structure.ok) return structure;
    const block = value as Block;
    const { header } = block;
    const last = this.lastBlock;

    // 2. Номер блоку
    if (header.index !== last.header.index + 1) {
      return fail(
        `Неправильний номер блоку: очікується ${last.header.index + 1}, отримано ${header.index}`,
      );
    }
    // 3. Зв'язок з попереднім блоком
    if (header.previousHash !== blockHash(last.header)) {
      return fail("previousHash не збігається з хешем попереднього блоку");
    }
    // 4. Складність має бути саме така, яку вимагає підстройка
    const expectedDifficulty = this.getNextDifficulty();
    if (header.difficulty !== expectedDifficulty) {
      return fail(
        `Неправильна складність: очікується ${expectedDifficulty}, отримано ${header.difficulty}`,
      );
    }
    // 5. Proof of Work
    if (!meetsDifficulty(header)) {
      return fail(
        "Хеш блоку не відповідає заявленій складності (Proof of Work)",
      );
    }

    // 6. Транзакції по порядку: підпис, nonce, баланс (з урахуванням попередніх транзакцій блоку)
    const reward = block.transactions[0] as RewardTransaction;
    const regular = block.transactions.slice(1) as Transaction[];
    const fx = newEffects();
    fx.balance.set(reward.to, reward.amount); // винагорода йде першою: майнер може витратити її вже в цьому блоці

    for (const [i, tx] of regular.entries()) {
      const check = this.#checkTransaction(tx, fx);
      if (!check.ok) return fail(`Транзакція №${i + 1}: ${check.reason}`);
      this.#applyTransaction(tx, fx);
    }
    return {
      ok: true,
      effects: fx,
      regularIds: regular.map((tx) => transactionId(tx)),
    };
  }

  // Перевіряє блок і, якщо все гаразд, додає його до ланцюга. Приймає unknown (блок може прийти з мережі).
  addBlock(value: unknown): CheckResult {
    const result = this.#evaluate(value);
    if (!result.ok) return result;

    this.#blocks.push(value as Block);
    for (const [address, delta] of result.effects.balance) {
      this.#balances.set(address, (this.#balances.get(address) ?? 0) + delta);
    }
    for (const [address, count] of result.effects.nonces) {
      this.#nonceCounts.set(
        address,
        (this.#nonceCounts.get(address) ?? 0) + count,
      );
    }
    for (const id of result.regularIds) this.#txIds.add(id);
    return { ok: true };
  }

  // Повна перевірка ланцюга: будуємо його з нуля, додаючи блоки по черзі до порожнього ланцюга
  // з нашим генезис-блоком. Ті самі правила, що й при додаванні блоку, тож розбіжностей немає.
  static fromBlocks(
    value: unknown,
    options: ChainOptions = {},
  ): ChainLoadResult {
    if (!Array.isArray(value) || value.length === 0) {
      return fail("Ланцюг має бути непорожнім масивом блоків");
    }
    const chain = new Blockchain(options);

    const genesisCheck = verifyBlockStructure(value[0]);
    if (!genesisCheck.ok)
      return { ok: false, reason: `Блок №0: ${genesisCheck.reason}` };
    if (
      blockHash((value[0] as Block).header) !==
      blockHash((chain.#blocks[0] as Block).header)
    ) {
      return {
        ok: false,
        reason: "Блок №0: генезис-блок відрізняється від нашого",
      };
    }

    for (let i = 1; i < value.length; i++) {
      const result = chain.addBlock(value[i]);
      if (!result.ok)
        return { ok: false, reason: `Блок №${i}: ${result.reason}` };
    }
    return { ok: true, chain };
  }
}
