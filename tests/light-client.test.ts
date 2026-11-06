import { test } from "node:test";
import assert from "node:assert/strict";
import { Blockchain } from "../src/core/blockchain.ts";
import { Mempool } from "../src/core/mempool.ts";
import { mineNextBlock } from "../src/core/miner.ts";
import { createTransactionProof } from "../src/core/proof.ts";
import { blockTransactionId } from "../src/core/block.ts";
import { generateWallet } from "../src/core/wallet.ts";
import { createTransaction } from "../src/core/transaction.ts";
import { LightClient } from "../src/light/light-client.ts";
import type { BlockHeader } from "../src/core/block.ts";
import type { ChainOptions } from "../src/core/blockchain.ts";

const options: ChainOptions = {
  genesisDifficulty: 4,
  difficultyParams: {
    retargetInterval: 3,
    targetBlockTimeMs: 10_000,
    minDifficulty: 1,
  },
};

// Ланцюг із кількома блоками; у третьому блоці винагорода і два перекази
function buildChain() {
  const chain = new Blockchain(options);
  const pool = new Mempool(chain);
  const alice = generateWallet();
  const bob = generateWallet();
  const mine = (): void => {
    assert.deepEqual(
      chain.addBlock(mineNextBlock(chain, pool, alice.address)),
      { ok: true },
    );
    pool.revalidate();
  };
  mine();
  mine();
  pool.add(createTransaction(alice, bob.address, 5, 1, 0));
  pool.add(createTransaction(alice, bob.address, 6, 1, 1));
  mine();
  return chain;
}

const headersOf = (chain: Blockchain): BlockHeader[] =>
  chain.blocks.map((block) => block.header);

test("легкий клієнт зберігає лише заголовки і доказом Меркла підтверджує кожну транзакцію ланцюга", () => {
  const chain = buildChain();
  const light = new LightClient(options);
  assert.deepEqual(light.loadHeaders(headersOf(chain)), { ok: true });

  for (const block of chain.blocks.slice(1)) {
    for (const tx of block.transactions) {
      const id = blockTransactionId(tx);
      assert.deepEqual(
        light.verifyInclusion(id, createTransactionProof(chain, id)),
        { ok: true },
      );
    }
  }
  assert.equal(createTransactionProof(chain, "a".repeat(64)), null); // транзакції, якої немає, доказу немає
});

test("легкий клієнт не вірить вузлу: підроблені заголовки і чужий доказ відхиляються", () => {
  const chain = buildChain();
  const light = new LightClient(options);

  // Заголовки з порушеним зв'язком не приймаються
  const tampered = JSON.parse(
    JSON.stringify(headersOf(chain)),
  ) as BlockHeader[];
  (tampered[2] as BlockHeader).previousHash = "f".repeat(64);
  assert.equal(light.loadHeaders(tampered).ok, false);

  // Доказ від іншої транзакції не підходить
  light.loadHeaders(headersOf(chain));
  const block = chain.blocks[3]!;
  const idA = blockTransactionId(block.transactions[1]!);
  const idB = blockTransactionId(block.transactions[2]!);
  const proofA = createTransactionProof(chain, idA)!;
  assert.equal(light.verifyInclusion(idB, { ...proofA, txId: idB }).ok, false);
});
