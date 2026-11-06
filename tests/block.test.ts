import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWallet } from "../src/core/wallet.ts";
import { createTransaction } from "../src/core/transaction.ts";
import { createReward } from "../src/core/reward.ts";
import {
  blockHash,
  createBlock,
  verifyBlockStructure,
} from "../src/core/block.ts";
import type { BlockHeader } from "../src/core/block.ts";

const ZERO_HASH = "0".repeat(64);

// Нормальний блок: винагорода майнеру першою, потім звичайні транзакції
function sampleBlock(txCount = 3) {
  const alice = generateWallet();
  const bob = generateWallet();
  const miner = generateWallet();
  const regular = Array.from({ length: txCount }, (_, i) =>
    createTransaction(alice, bob.address, 5, 1, i),
  );
  const transactions = [createReward(miner.address, regular), ...regular];
  return {
    block: createBlock({
      index: 1,
      timestamp: 1_700_000_000_000,
      previousHash: ZERO_HASH,
      difficulty: 4,
      transactions,
    }),
    regular,
    miner,
  };
}

test("blockHash: 64 hex-символи і не залежить від порядку полів в об'єкті", () => {
  const h = sampleBlock().block.header;
  const reordered: BlockHeader = {
    nonce: h.nonce,
    difficulty: h.difficulty,
    merkleRoot: h.merkleRoot,
    previousHash: h.previousHash,
    timestamp: h.timestamp,
    index: h.index,
  };
  assert.match(blockHash(h), /^[0-9a-f]{64}$/);
  assert.equal(blockHash(h), blockHash(reordered));
});

test("blockHash: зміна будь-якого поля заголовка змінює хеш блоку", () => {
  const { header } = sampleBlock().block;
  const original = blockHash(header);
  const changes: Partial<BlockHeader>[] = [
    { index: header.index + 1 },
    { timestamp: header.timestamp + 1 },
    { previousHash: "f".repeat(64) },
    { merkleRoot: "f".repeat(64) },
    { difficulty: header.difficulty + 1 },
    { nonce: header.nonce + 1 },
  ];
  for (const change of changes) {
    assert.notEqual(blockHash({ ...header, ...change }), original);
  }
});

test("verifyBlockStructure: нормальний блок і генезис-блок проходять", () => {
  assert.deepEqual(verifyBlockStructure(sampleBlock().block), { ok: true });
  const genesis = createBlock({
    index: 0,
    timestamp: 0,
    previousHash: ZERO_HASH,
    difficulty: 1,
    transactions: [],
  });
  assert.deepEqual(verifyBlockStructure(genesis), { ok: true });
});

test("verifyBlockStructure: підміна транзакції без перерахунку кореня Меркла відхиляється", () => {
  const { block } = sampleBlock();
  const [reward, first, ...rest] = block.transactions;
  const tampered = {
    ...block,
    transactions: [reward, { ...first, amount: 500 }, ...rest],
  };
  const result = verifyBlockStructure(tampered);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /Меркла/);
});

test("verifyBlockStructure: повторювана транзакція в блоці відхиляється", () => {
  const alice = generateWallet();
  const bob = generateWallet();
  const miner = generateWallet();
  const tx = createTransaction(alice, bob.address, 5, 1, 0);
  const transactions = [createReward(miner.address, [tx, tx]), tx, tx];
  const block = createBlock({
    index: 1,
    timestamp: 1,
    previousHash: ZERO_HASH,
    difficulty: 4,
    transactions,
  });
  const result = verifyBlockStructure(block);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /повторювана/);
});

test("verifyBlockStructure: правила винагороди (немає, не першою, дві, неправильна сума)", () => {
  const { regular, miner } = sampleBlock();
  const reward = createReward(miner.address, regular);
  const make = (transactions: unknown[]) =>
    verifyBlockStructure(
      createBlock({
        index: 1,
        timestamp: 1,
        previousHash: ZERO_HASH,
        difficulty: 4,
        transactions: transactions as never,
      }),
    );

  assert.equal(make([...regular]).ok, false);
  assert.equal(make([]).ok, false);
  assert.equal(make([regular[0], reward, ...regular.slice(1)]).ok, false);
  assert.equal(make([reward, reward, ...regular]).ok, false);

  const inflated = { ...reward, amount: reward.amount + 1 };
  const result = make([inflated, ...regular]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /Винагорода/);

  assert.equal(make([reward, ...regular]).ok, true);
});

test("verifyBlockStructure: у генезис-блоці транзакцій бути не повинно", () => {
  const { regular, miner } = sampleBlock();
  const withTx = createBlock({
    index: 0,
    timestamp: 0,
    previousHash: ZERO_HASH,
    difficulty: 1,
    transactions: [createReward(miner.address, regular), ...regular],
  });
  assert.equal(verifyBlockStructure(withTx).ok, false);
});

test("verifyBlockStructure: сміттєві дані не кидають виняток, а дають відмову", () => {
  const { block } = sampleBlock();
  const garbage: unknown[] = [
    null,
    undefined,
    "abc",
    42,
    [],
    {},
    { ...block, extra: 1 },
    { ...block, header: { ...block.header, index: -1 } },
    { ...block, header: { ...block.header, previousHash: "abc" } },
    { ...block, transactions: "не масив" },
    { ...block, transactions: [{ from: 1 }] },
  ];
  for (const item of garbage) {
    assert.equal(verifyBlockStructure(item).ok, false);
  }
});
