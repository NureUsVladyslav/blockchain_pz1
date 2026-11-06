import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWallet } from "../src/core/wallet.ts";
import { createTransaction } from "../src/core/transaction.ts";
import {
  checkRewardFormat,
  createReward,
  rewardId,
} from "../src/core/reward.ts";
import { BLOCK_REWARD } from "../src/config.ts";

test("createReward: сума це фіксована винагорода плюс комісії всіх транзакцій блоку", () => {
  const alice = generateWallet();
  const bob = generateWallet();
  const miner = generateWallet();
  const txs = [
    createTransaction(alice, bob.address, 5, 2, 0),
    createTransaction(alice, bob.address, 5, 3, 1),
  ];

  assert.equal(createReward(miner.address, []).amount, BLOCK_REWARD);
  assert.equal(createReward(miner.address, txs).amount, BLOCK_REWARD + 2 + 3);
  assert.equal(createReward(miner.address, txs).to, miner.address);
});

test("checkRewardFormat: правильна проходить, некоректні відхиляються", () => {
  const miner = generateWallet();
  const reward = createReward(miner.address, []);

  assert.deepEqual(checkRewardFormat(reward), { ok: true });
  assert.equal(checkRewardFormat(null).ok, false);
  assert.equal(checkRewardFormat({ ...reward, type: "other" }).ok, false);
  assert.equal(checkRewardFormat({ ...reward, to: "abc" }).ok, false);
  assert.equal(checkRewardFormat({ ...reward, amount: 1.5 }).ok, false);
  assert.equal(checkRewardFormat({ ...reward, amount: -1 }).ok, false);
  assert.equal(checkRewardFormat({ ...reward, extra: 1 }).ok, false);
});

test("rewardId: стабільний і залежить від адреси та суми", () => {
  const a = generateWallet();
  const b = generateWallet();
  const reward = createReward(a.address, []);

  assert.match(rewardId(reward), /^[0-9a-f]{64}$/);
  assert.equal(rewardId(reward), rewardId({ ...reward }));
  assert.notEqual(rewardId(reward), rewardId(createReward(b.address, [])));
  assert.notEqual(
    rewardId(reward),
    rewardId({ ...reward, amount: reward.amount + 1 }),
  );
});
