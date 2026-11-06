import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWallet } from "../src/core/wallet.ts";
import { signBytes, verifyBytes } from "../src/utils/signature.ts";

const bytes = (text: string) => Buffer.from(text, "utf8");

test("справжній підпис проходить перевірку", () => {
  const wallet = generateWallet();
  const message = bytes("переказ 5 монет");
  const signature = signBytes(message, wallet.privateKey);

  assert.match(signature, /^[0-9a-f]{128}$/);
  assert.equal(verifyBytes(message, signature, wallet.publicKey), true);
});

test("змінене повідомлення не проходить перевірку", () => {
  const wallet = generateWallet();
  const signature = signBytes(bytes("переказ 5 монет"), wallet.privateKey);

  assert.equal(
    verifyBytes(bytes("переказ 500 монет"), signature, wallet.publicKey),
    false,
  );
});

test("чужий публічний ключ не проходить перевірку", () => {
  const alice = generateWallet();
  const mallory = generateWallet();
  const message = bytes("переказ 5 монет");
  const signature = signBytes(message, alice.privateKey);

  assert.equal(verifyBytes(message, signature, mallory.publicKey), false);
});

test("сміттєві вхідні дані дають false, а не падіння", () => {
  const wallet = generateWallet();
  const message = bytes("переказ 5 монет");
  const signature = signBytes(message, wallet.privateKey);

  assert.equal(verifyBytes(message, "abc", wallet.publicKey), false);
  assert.equal(verifyBytes(message, "zz".repeat(64), wallet.publicKey), false);
  assert.equal(verifyBytes(message, signature, "abc"), false);
  assert.equal(verifyBytes(message, signature, "zz".repeat(32)), false);
  assert.equal(verifyBytes(message, "00".repeat(64), "00".repeat(32)), false);
});
