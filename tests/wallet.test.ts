import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWallet, addressFromPublicKey } from "../src/core/wallet.ts";
import { sha256 } from "../src/utils/hash.ts";

test("generateWallet: ключі та адреса мають формат 64 hex-символи", () => {
  const wallet = generateWallet();
  assert.match(wallet.publicKey, /^[0-9a-f]{64}$/);
  assert.match(wallet.privateKey, /^[0-9a-f]{64}$/);
  assert.match(wallet.address, /^[0-9a-f]{64}$/);
});

test("адреса це SHA-256 від БАЙТІВ публічного ключа, а не від hex-тексту", () => {
  const wallet = generateWallet();
  assert.equal(wallet.address, sha256(Buffer.from(wallet.publicKey, "hex")));
  assert.notEqual(wallet.address, sha256(wallet.publicKey));
  assert.equal(addressFromPublicKey(wallet.publicKey), wallet.address);
});
