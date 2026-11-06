import { canonicalize } from "../utils/serialize.ts";
import { sha256 } from "../utils/hash.ts";
import { isHex } from "../utils/hex.ts";
import { hasExactKeys, isObject } from "../utils/object.ts";
import { merkleRoot } from "./merkle.ts";
import { checkTransactionFormat, transactionId } from "./transaction.ts";
import { checkRewardFormat, expectedRewardAmount, rewardId } from "./reward.ts";
import type { CheckResult, Transaction } from "./transaction.ts";
import type { RewardTransaction } from "./reward.ts";

// Заголовок блоку. Хеш блоку рахується тільки від нього.
export interface BlockHeader {
  index: number;
  timestamp: number;
  previousHash: string;
  merkleRoot: string;
  difficulty: number;
  nonce: number;
}

// У блоці або винагорода майнеру (перша), або звичайна транзакція
export type BlockTransaction = RewardTransaction | Transaction;

export interface Block {
  header: BlockHeader;
  transactions: BlockTransaction[];
}

const fail = (reason: string): CheckResult => ({ ok: false, reason });

const HEADER_FIELDS = [
  "index",
  "timestamp",
  "previousHash",
  "merkleRoot",
  "difficulty",
  "nonce",
];
const HEADER_HASH_FIELDS = ["previousHash", "merkleRoot"];
const HEADER_INTEGER_FIELDS = ["index", "timestamp", "difficulty", "nonce"];

// Хеш блоку: SHA-256 від канонічного запису заголовка
export function blockHash(header: BlockHeader): string {
  const { index, timestamp, previousHash, merkleRoot, difficulty, nonce } =
    header;
  return sha256(
    canonicalize({
      index,
      timestamp,
      previousHash,
      merkleRoot,
      difficulty,
      nonce,
    }),
  );
}

// Ідентифікатор будь-якої транзакції блоку (винагорода має власну форму)
export function blockTransactionId(tx: BlockTransaction): string {
  return "type" in tx ? rewardId(tx) : transactionId(tx);
}

// Корінь Меркла для списку транзакцій блоку (листки це id транзакцій)
export function transactionsMerkleRoot(
  transactions: BlockTransaction[],
): string {
  return merkleRoot(transactions.map((tx) => blockTransactionId(tx)));
}
// Перевіряє форму заголовка блоку
export function checkHeader(header: unknown): CheckResult {
  if (!isObject(header)) return fail("Заголовок блоку має бути об'єктом");
  if (!hasExactKeys(header, HEADER_FIELDS)) {
    return fail(
      `Заголовок має містити рівно такі поля: ${HEADER_FIELDS.join(", ")}`,
    );
  }
  for (const name of HEADER_HASH_FIELDS) {
    if (!isHex(header[name], 32)) {
      return fail(`Поле ${name} має бути рядком із 64 hex-символів`);
    }
  }
  for (const name of HEADER_INTEGER_FIELDS) {
    const value = header[name];
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < 0
    ) {
      return fail(`Поле ${name} має бути цілим числом не менше 0`);
    }
  }
  return { ok: true };
}

export interface NewBlockParams {
  index: number;
  timestamp: number;
  previousHash: string;
  difficulty: number;
  transactions: BlockTransaction[];
  nonce?: number;
}

export function createBlock(params: NewBlockParams): Block {
  const header: BlockHeader = {
    index: params.index,
    timestamp: params.timestamp,
    previousHash: params.previousHash,
    merkleRoot: transactionsMerkleRoot(params.transactions),
    difficulty: params.difficulty,
    nonce: params.nonce ?? 0,
  };
  const check = checkHeader(header);
  if (!check.ok) throw new Error(`Не можна створити блок: ${check.reason}`);
  return { header, transactions: params.transactions };
}

// Перевіряє власну цілісність блоку (без ланцюга): форма, винагорода, формат транзакцій,
// відсутність дублікатів і збіг кореня Меркла. Приймає unknown, не кидає винятків.
// Хеш блоку, складність, посилання на попередній блок, підписи і баланси тут НЕ перевіряються.
export function verifyBlockStructure(value: unknown): CheckResult {
  if (!isObject(value)) return fail("Блок має бути об'єктом");
  if (!hasExactKeys(value, ["header", "transactions"])) {
    return fail("Блок має містити рівно два поля: header і transactions");
  }

  const headerCheck = checkHeader(value.header);
  if (!headerCheck.ok) return headerCheck;
  const header = value.header as BlockHeader;

  if (!Array.isArray(value.transactions))
    return fail("Поле transactions має бути масивом");
  const transactions = value.transactions as unknown[];

  if (header.index === 0) {
    // Генезис-блок: без транзакцій
    if (transactions.length > 0)
      return fail("У генезис-блоці не має бути транзакцій");
  } else {
    // Звичайний блок: перша транзакція це винагорода, решта звичайні
    const reward = transactions[0];
    if (reward === undefined)
      return fail("У блоці має бути транзакція-винагорода");
    const rewardCheck = checkRewardFormat(reward);
    if (!rewardCheck.ok)
      return fail(
        `Перша транзакція має бути винагородою: ${rewardCheck.reason}`,
      );

    const regular = transactions.slice(1);
    for (const [i, tx] of regular.entries()) {
      const check = checkTransactionFormat(tx);
      if (!check.ok) return fail(`Транзакція №${i + 1}: ${check.reason}`);
    }

    // Винагорода = фіксована сума + комісії всіх звичайних транзакцій цього блоку
    const expected = expectedRewardAmount(regular as Transaction[]);
    if ((reward as RewardTransaction).amount !== expected) {
      return fail(`Винагорода не відповідає очікуваній: має бути ${expected}`);
    }
  }

  // Дублікат транзакції дав би той самий корінь Меркла, тому такі блоки заборонені
  const ids = (transactions as BlockTransaction[]).map((tx) =>
    blockTransactionId(tx),
  );
  if (new Set(ids).size !== ids.length) {
    return fail("У блоці є повторювана транзакція");
  }

  if (merkleRoot(ids) !== header.merkleRoot) {
    return fail("Корінь Меркла в заголовку не збігається з транзакціями");
  }
  return { ok: true };
}
