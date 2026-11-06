import { canonicalize } from "../utils/serialize.ts";
import { sha256 } from "../utils/hash.ts";
import { isHex } from "../utils/hex.ts";
import { hasExactKeys, isObject } from "../utils/object.ts";
import { BLOCK_REWARD } from "../config.ts";
import type { CheckResult, Transaction } from "./transaction.ts";

export interface RewardTransaction {
  type: "reward";
  to: string;
  amount: number;
}

const fail = (reason: string): CheckResult => ({ ok: false, reason });

// Скільки має дорівнювати винагорода блоку з такими звичайними транзакціями
export function expectedRewardAmount(transactions: Transaction[]): number {
  return BLOCK_REWARD + transactions.reduce((sum, tx) => sum + tx.fee, 0);
}

// Створює винагороду для майнера за блок із такими звичайними транзакціями
export function createReward(
  minerAddress: string,
  transactions: Transaction[],
): RewardTransaction {
  return {
    type: "reward",
    to: minerAddress,
    amount: expectedRewardAmount(transactions),
  };
}

// Перевіряє форму винагороди (приймає unknown, бо дані з мережі)
export function checkRewardFormat(value: unknown): CheckResult {
  if (!isObject(value)) return fail("Винагорода має бути об'єктом");
  if (!hasExactKeys(value, ["type", "to", "amount"])) {
    return fail("Винагорода має містити рівно поля: type, to, amount");
  }
  if (value.type !== "reward")
    return fail("Поле type винагороди має дорівнювати 'reward'");
  if (!isHex(value.to, 32))
    return fail("Поле to винагороди має бути рядком із 64 hex-символів");
  if (
    typeof value.amount !== "number" ||
    !Number.isSafeInteger(value.amount) ||
    value.amount < 0
  ) {
    return fail("Поле amount винагороди має бути цілим числом не менше 0");
  }
  return { ok: true };
}

export function rewardId(reward: RewardTransaction): string {
  const { type, to, amount } = reward;
  return sha256(canonicalize({ type, to, amount }));
}
