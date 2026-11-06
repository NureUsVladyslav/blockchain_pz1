import { blockTransactionId } from "./block.ts";
import { merkleProof } from "./merkle.ts";
import type { Blockchain } from "./blockchain.ts";
import type { MerkleProofStep } from "./merkle.ts";

// Доказ того, що транзакція входить у блок: номер блоку і хеші-сусіди для перевірки кореня Меркла
export interface TransactionProof {
  blockIndex: number;
  txId: string;
  proof: MerkleProofStep[];
}

// Будує доказ для транзакції з таким id. Якщо в ланцюгу її немає, повертає null.
export function createTransactionProof(
  chain: Blockchain,
  txId: string,
): TransactionProof | null {
  const found = chain.findTransaction(txId);
  if (found === null) return null;
  const leaves = found.block.transactions.map((tx) => blockTransactionId(tx));
  return {
    blockIndex: found.block.header.index,
    txId,
    proof: merkleProof(leaves, found.index),
  };
}
