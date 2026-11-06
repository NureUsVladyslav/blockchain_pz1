import { canonicalize } from "../utils/serialize.ts";
import { sha256 } from "../utils/hash.ts";
import { isHex } from "../utils/hex.ts";
import { signBytes, verifyBytes } from "../utils/signature.ts";
import { addressFromPublicKey } from "./wallet.ts";
import type { Wallet } from "./wallet.ts";

// Транзакція: переказ монет від одного адреса до іншого.
export interface Transaction {
  from: string; // адреса відправника (64 hex)
  publicKey: string; // публічний ключ відправника (64 hex)
  to: string; // адреса отримувача (64 hex)
  amount: number; // сума, ціле число > 0
  fee: number; // комісія майнеру, ціле число >= 0
  nonce: number; // порядковий номер транзакції ЦЬОГО відправника
  signature: string; // підпис шести полів вище (128 hex)
}

// Результат перевірки: або "все гаразд", або "відхилено" з причиною.
export type CheckResult = { ok: true } | { ok: false; reason: string };

const fail = (reason: string): CheckResult => ({ ok: false, reason });

// Усі сім полів транзакції.
const TRANSACTION_FIELDS = [
  "from",
  "publicKey",
  "to",
  "amount",
  "fee",
  "nonce",
  "signature",
];

// Поля, які є hex-рядками по 32 байти (64 символи)
const HEX_FIELDS_32 = ["from", "publicKey", "to"];

// Цілі числа та їхні мінімально допустимі значення
const MIN_VALUES: Record<string, number> = { amount: 1, fee: 0, nonce: 0 };

// Перевіряє шість полів, які підписуються (усі, крім signature).
function checkFields(obj: Record<string, unknown>): CheckResult {
  for (const name of HEX_FIELDS_32) {
    if (!isHex(obj[name], 32)) {
      return fail(`Поле ${name} має бути рядком із 64 hex-символів`);
    }
  }
  for (const [name, min] of Object.entries(MIN_VALUES)) {
    const value = obj[name];
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < min
    ) {
      return fail(`Поле ${name} має бути цілим числом не менше ${min}`);
    }
  }
  return { ok: true };
}

// Перевіряє ФОРМУ транзакції.
export function checkTransactionFormat(value: unknown): CheckResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("Транзакція має бути об'єктом");
  }
  const obj = value as Record<string, unknown>;

  // Рівно сім полів: ні більше, ні менше
  const actual = Object.keys(obj).sort().join(",");
  const expected = [...TRANSACTION_FIELDS].sort().join(",");
  if (actual !== expected) {
    return fail(
      `Транзакція має містити рівно такі поля: ${TRANSACTION_FIELDS.join(", ")}`,
    );
  }

  if (!isHex(obj.signature, 64)) {
    return fail("Поле signature має бути рядком із 128 hex-символів");
  }
  return checkFields(obj);
}

// Байти, які підписуються: канонічний запис шести полів БЕЗ підпису.
export function transactionSigningBytes(
  tx: Omit<Transaction, "signature">,
): Uint8Array {
  const { from, publicKey, to, amount, fee, nonce } = tx;
  return Buffer.from(
    canonicalize({ from, publicKey, to, amount, fee, nonce }),
    "utf8",
  );
}

// Створює і підписує транзакцію від імені гаманця
export function createTransaction(
  wallet: Wallet,
  to: string,
  amount: number,
  fee: number,
  nonce: number,
): Transaction {
  const unsigned = {
    from: wallet.address,
    publicKey: wallet.publicKey,
    to,
    amount,
    fee,
    nonce,
  };

  const check = checkFields(unsigned);
  if (!check.ok) {
    throw new Error(`Не можна створити транзакцію: ${check.reason}`);
  }

  const signature = signBytes(
    transactionSigningBytes(unsigned),
    wallet.privateKey,
  );
  return { ...unsigned, signature };
}

// Ідентифікатор транзакції: SHA-256 від канонічного запису.
export function transactionId(tx: Transaction): string {
  const { from, publicKey, to, amount, fee, nonce, signature } = tx;
  return sha256(
    canonicalize({ from, publicKey, to, amount, fee, nonce, signature }),
  );
}

// Повна перевірка транзакції (без урахування балансу, nonce-порядку і дублікатів)
export function verifyTransaction(value: unknown): CheckResult {
  const format = checkTransactionFormat(value);
  if (!format.ok) return format;

  const tx = value as Transaction;

  if (addressFromPublicKey(tx.publicKey) !== tx.from) {
    return fail("Публічний ключ не відповідає адресі відправника");
  }

  if (!verifyBytes(transactionSigningBytes(tx), tx.signature, tx.publicKey)) {
    return fail("Підпис недійсний");
  }

  return { ok: true };
}
