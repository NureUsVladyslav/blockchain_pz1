import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWallet } from "../src/core/wallet.ts";
import { createTransaction, transactionId } from "../src/core/transaction.ts";
import { Mempool } from "../src/core/mempool.ts";
import type { ChainView } from "../src/core/mempool.ts";

function fakeChain(
  balances: Record<string, number>,
  nonces: Record<string, number> = {},
): ChainView {
  return {
    getBalance: (address) => balances[address] ?? 0,
    getNextNonce: (address) => nonces[address] ?? 0,
    hasTransaction: () => false,
  };
}

test("мемпул приймає нормальну транзакцію", () => {
  const alice = generateWallet();
  const bob = generateWallet();
  const pool = new Mempool(fakeChain({ [alice.address]: 100 }));
  const tx = createTransaction(alice, bob.address, 5, 1, 0);

  assert.deepEqual(pool.add(tx), { ok: true });
  assert.equal(pool.size, 1);
  assert.equal(pool.has(transactionId(tx)), true);
});

test("мемпул відхиляє транзакцію з недійсним підписом і пояснює причину", () => {
  const alice = generateWallet();
  const bob = generateWallet();
  const pool = new Mempool(fakeChain({ [alice.address]: 100 }));
  const tx = createTransaction(alice, bob.address, 5, 1, 0);

  const result = pool.add({ ...tx, amount: 50 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /Підпис/);
  assert.equal(pool.size, 0);
});

test("мемпул перевіряє nonce: пропуск і повтор відхиляються", () => {
  const alice = generateWallet();
  const bob = generateWallet();
  const pool = new Mempool(fakeChain({ [alice.address]: 100 }));

  assert.equal(
    pool.add(createTransaction(alice, bob.address, 1, 1, 0)).ok,
    true,
  );

  const gap = pool.add(createTransaction(alice, bob.address, 1, 1, 2));
  assert.equal(gap.ok, false);
  if (!gap.ok) assert.match(gap.reason, /nonce/);

  const repeat = pool.add(createTransaction(alice, bob.address, 2, 1, 0));
  assert.equal(repeat.ok, false);

  assert.equal(
    pool.add(createTransaction(alice, bob.address, 1, 1, 1)).ok,
    true,
  );

  const pool2 = new Mempool(
    fakeChain({ [alice.address]: 100 }, { [alice.address]: 1 }),
  );
  const replay = pool2.add(createTransaction(alice, bob.address, 1, 1, 0));
  assert.equal(replay.ok, false);
  if (!replay.ok) assert.match(replay.reason, /nonce/);
});

test("мемпул враховує баланс разом із транзакціями відправника, що вже чекають", () => {
  const alice = generateWallet();
  const bob = generateWallet();
  const pool = new Mempool(fakeChain({ [alice.address]: 10 }));

  assert.equal(
    pool.add(createTransaction(alice, bob.address, 6, 1, 0)).ok,
    true,
  );

  const tooMuch = pool.add(createTransaction(alice, bob.address, 3, 1, 1));
  assert.equal(tooMuch.ok, false);
  if (!tooMuch.ok) assert.match(tooMuch.reason, /коштів/);

  assert.equal(
    pool.add(createTransaction(alice, bob.address, 2, 1, 1)).ok,
    true,
  );
});

test("remove прибирає транзакції з черги", () => {
  const alice = generateWallet();
  const bob = generateWallet();
  const pool = new Mempool(fakeChain({ [alice.address]: 100 }));
  const tx = createTransaction(alice, bob.address, 5, 1, 0);
  pool.add(tx);

  pool.remove([transactionId(tx)]);
  assert.equal(pool.size, 0);
  assert.equal(pool.has(transactionId(tx)), false);
  assert.deepEqual(pool.getAll(), []);
});
