import { blockHash, createBlock } from "./block.ts";
import { mineBlock } from "./pow.ts";
import { createReward } from "./reward.ts";
import type { Block } from "./block.ts";
import type { Blockchain } from "./blockchain.ts";
import type { Mempool } from "./mempool.ts";

// Збирає і майнить наступний блок: транзакції з мемпулу (лише ті, що ще дійсні),
// винагорода майнеру першою, складність з підстройки. Ланцюг і мемпул не змінює:
// викликач сам додає блок до ланцюга (chain.addBlock) і оновлює мемпул (pool.revalidate).
export function mineNextBlock(
  chain: Blockchain,
  pool: Mempool,
  minerAddress: string,
  timestamp: number = Date.now(),
): Block {
  const regular = chain.selectTransactions(pool.getAll());
  const reward = createReward(minerAddress, regular);
  const candidate = createBlock({
    index: chain.lastBlock.header.index + 1,
    timestamp,
    previousHash: blockHash(chain.lastBlock.header),
    difficulty: chain.getNextDifficulty(),
    transactions: [reward, ...regular],
  });
  return mineBlock(candidate);
}
