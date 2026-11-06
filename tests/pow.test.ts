import { test } from "node:test";
import assert from "node:assert/strict";
import {
  leadingZeroBits,
  meetsDifficulty,
  mineBlock,
} from "../src/core/pow.ts";
import { createBlock, blockHash } from "../src/core/block.ts";
import { createReward } from "../src/core/reward.ts";
import { generateWallet } from "../src/core/wallet.ts";

const rest = "f".repeat(60);
test("leadingZeroBits: рахує нульові біти на початку хешу", () => {
  assert.equal(leadingZeroBits("ffff" + rest), 0);
  assert.equal(leadingZeroBits("8000" + rest), 0); // 1000 0000
  assert.equal(leadingZeroBits("4000" + rest), 1); // 0100 0000
  assert.equal(leadingZeroBits("0fff" + rest), 4); // 0000 1111
  assert.equal(leadingZeroBits("0001" + rest), 15); // 0000 0000 0000 0001
  assert.equal(leadingZeroBits("00ff" + rest), 8);
  assert.equal(leadingZeroBits("0".repeat(64)), 256);
});

test("leadingZeroBits: хеш не у форматі 64 hex-символи викликає помилку", () => {
  assert.throws(() => leadingZeroBits("abc"), /64 hex/);
});

test("mineBlock: знаходить nonce, при якому хеш підходить, і перший такий", () => {
  const miner = generateWallet();
  const block = createBlock({
    index: 1,
    timestamp: 1_700_000_000_000,
    previousHash: "0".repeat(64),
    difficulty: 8,
    transactions: [createReward(miner.address, [])],
  });
  const mined = mineBlock(block);

  assert.equal(meetsDifficulty(mined.header), true);
  assert.ok(leadingZeroBits(blockHash(mined.header)) >= 8);

  assert.deepEqual(
    { ...mined.header, nonce: 0 },
    { ...block.header, nonce: 0 },
  );
  assert.deepEqual(mined.transactions, block.transactions);

  if (mined.header.nonce > 0) {
    assert.equal(
      meetsDifficulty({ ...mined.header, nonce: mined.header.nonce - 1 }),
      false,
    );
  }
});

test("mineBlock: складність більше 256 бітів неможлива", () => {
  const miner = generateWallet();
  const block = createBlock({
    index: 1,
    timestamp: 1,
    previousHash: "0".repeat(64),
    difficulty: 300,
    transactions: [createReward(miner.address, [])],
  });
  assert.throws(() => mineBlock(block), /256/);
});
