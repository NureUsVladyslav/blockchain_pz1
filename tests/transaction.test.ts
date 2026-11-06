import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWallet } from "../src/core/wallet.ts";
import {
  checkTransactionFormat,
  createTransaction,
  transactionId,
  transactionSigningBytes,
  verifyTransaction,
} from "../src/core/transaction.ts";
import { signBytes } from "../src/utils/signature.ts";

test("createTransaction створює підписану транзакцію правильного формату", () => {
  const alice = generateWallet();
  const bob = generateWallet();
  const tx = createTransaction(alice, bob.address, 5, 1, 0);

  assert.equal(tx.from, alice.address);
  assert.equal(tx.publicKey, alice.publicKey);
  assert.equal(Object.keys(tx).length, 7);
  assert.deepEqual(checkTransactionFormat(tx), { ok: true });
});

test("checkTransactionFormat відхиляє некоректні транзакції з причиною", () => {
  const alice = generateWallet();
  const bob = generateWallet();
  const tx = createTransaction(alice, bob.address, 5, 1, 0);

  for (const garbage of [null, "abc", 42, []]) {
    assert.equal(checkTransactionFormat(garbage).ok, false);
  }
  assert.equal(checkTransactionFormat({ ...tx, amount: 0 }).ok, false);
  assert.equal(checkTransactionFormat({ ...tx, amount: 1.5 }).ok, false);
  assert.equal(checkTransactionFormat({ ...tx, amount: "5" }).ok, false);
  assert.equal(checkTransactionFormat({ ...tx, fee: -1 }).ok, false);
  assert.equal(checkTransactionFormat({ ...tx, nonce: 1.5 }).ok, false);
  assert.equal(
    checkTransactionFormat({ ...tx, publicKey: "zz".repeat(32) }).ok,
    false,
  );
  assert.equal(checkTransactionFormat({ ...tx, to: "A".repeat(64) }).ok, false);
  assert.equal(checkTransactionFormat({ ...tx, signature: "ab" }).ok, false);
  assert.equal(checkTransactionFormat({ ...tx, extra: 1 }).ok, false);
  const withoutSignature: Record<string, unknown> = { ...tx };
  delete withoutSignature.signature;
  assert.equal(checkTransactionFormat(withoutSignature).ok, false);

  const result = checkTransactionFormat({ ...tx, amount: 0 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /amount/);
});

test("createTransaction кидає помилку на некоректних аргументах", () => {
  const alice = generateWallet();
  const bob = generateWallet();
  assert.throws(
    () => createTransaction(alice, bob.address, 1.5, 1, 0),
    /amount/,
  );
  assert.throws(() => createTransaction(alice, "не-адреса", 5, 1, 0), /to/);
});

test("transactionId: стабільний для тієї самої транзакції і залежить від nonce", () => {
  const alice = generateWallet();
  const bob = generateWallet();
  const tx0 = createTransaction(alice, bob.address, 5, 1, 0);
  const tx1 = createTransaction(alice, bob.address, 5, 1, 1);

  assert.match(transactionId(tx0), /^[0-9a-f]{64}$/);
  assert.equal(transactionId(tx0), transactionId({ ...tx0 }));
  assert.notEqual(transactionId(tx0), transactionId(tx1));
});
test("verifyTransaction: справжня транзакція проходить перевірку", () => {
  const alice = generateWallet();
  const bob = generateWallet();
  const tx = createTransaction(alice, bob.address, 5, 1, 0);

  assert.deepEqual(verifyTransaction(tx), { ok: true });
});

test("verifyTransaction: зміна будь-якого підписаного поля ламає підпис", () => {
  const alice = generateWallet();
  const bob = generateWallet();
  const carol = generateWallet();
  const tx = createTransaction(alice, bob.address, 5, 1, 0);

  const tampered = [
    { ...tx, amount: 500 },
    { ...tx, fee: 0 },
    { ...tx, nonce: 1 },
    { ...tx, to: carol.address },
  ];
  for (const bad of tampered) {
    const result = verifyTransaction(bad);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /Підпис/);
  }
});

test("verifyTransaction: підробка відправника відхиляється", () => {
  const alice = generateWallet();
  const mallory = generateWallet();
  const bob = generateWallet();

  const body1 = {
    from: alice.address,
    publicKey: mallory.publicKey,
    to: bob.address,
    amount: 5,
    fee: 1,
    nonce: 0,
  };
  const forged1 = {
    ...body1,
    signature: signBytes(transactionSigningBytes(body1), mallory.privateKey),
  };
  const result1 = verifyTransaction(forged1);
  assert.equal(result1.ok, false);
  if (!result1.ok) assert.match(result1.reason, /адресі/);

  const body2 = {
    from: alice.address,
    publicKey: alice.publicKey,
    to: bob.address,
    amount: 5,
    fee: 1,
    nonce: 0,
  };
  const forged2 = {
    ...body2,
    signature: signBytes(transactionSigningBytes(body2), mallory.privateKey),
  };
  const result2 = verifyTransaction(forged2);
  assert.equal(result2.ok, false);
  if (!result2.ok) assert.match(result2.reason, /Підпис/);
});

test("verifyTransaction: сміттєві дані не кидають виняток, а дають відмову", () => {
  for (const garbage of [null, undefined, "abc", 42, [], {}, { from: 1 }]) {
    assert.equal(verifyTransaction(garbage).ok, false);
  }
});
