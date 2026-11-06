import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Blockchain } from "../src/core/blockchain.ts";
import { Mempool } from "../src/core/mempool.ts";
import { mineNextBlock } from "../src/core/miner.ts";
import { loadChain, saveChain } from "../src/core/storage.ts";
import { generateWallet } from "../src/core/wallet.ts";
import { createTransaction } from "../src/core/transaction.ts";
import type { ChainOptions } from "../src/core/blockchain.ts";
import type { Transaction } from "../src/core/transaction.ts";

const options: ChainOptions = {
  genesisDifficulty: 4,
  difficultyParams: {
    retargetInterval: 3,
    targetBlockTimeMs: 10_000,
    minDifficulty: 1,
  },
};

// Ланцюг із двома блоками і одним переказом; повертає ще адреси для перевірок
function buildChain() {
  const chain = new Blockchain(options);
  const pool = new Mempool(chain);
  const alice = generateWallet();
  const bob = generateWallet();

  chain.addBlock(mineNextBlock(chain, pool, alice.address));
  pool.add(createTransaction(alice, bob.address, 10, 1, 0));
  chain.addBlock(mineNextBlock(chain, pool, alice.address));
  return { chain, alice, bob };
}

function withTempFile(run: (file: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "pz1-chain-"));
  try {
    run(join(dir, "chain.json"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("збережений ланцюг завантажується назад таким самим, зі станом (баланси)", () => {
  withTempFile((file) => {
    const { chain, bob } = buildChain();
    saveChain(chain, file);
    const loaded = loadChain(file, options);

    assert.deepEqual(loaded.blocks, chain.blocks);
    assert.equal(loaded.getBalance(bob.address), 10);
  });
});

test("якщо файлу немає, створюється новий ланцюг з одним генезис-блоком", () => {
  withTempFile((file) => {
    assert.equal(loadChain(file, options).length, 1);
  });
});

test("підроблений або пошкоджений файл не завантажується", () => {
  withTempFile((file) => {
    const { chain } = buildChain();
    saveChain(chain, file);

    // Змінили суму переказу прямо у файлі
    const data = JSON.parse(readFileSync(file, "utf8")) as {
      transactions: Transaction[];
    }[];
    (data[2]!.transactions[1] as Transaction).amount = 9999;
    writeFileSync(file, JSON.stringify(data));
    assert.throws(() => loadChain(file, options), /не пройшов перевірку/);

    // Файл, що не є JSON
    writeFileSync(file, "це не json");
    assert.throws(() => loadChain(file, options), /JSON/);
  });
});
