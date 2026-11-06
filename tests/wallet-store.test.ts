import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadOrCreateWallet,
  loadWallet,
  saveWallet,
} from "../src/core/wallet-store.ts";
import { generateWallet } from "../src/core/wallet.ts";

function withTempFile(run: (file: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "pz1-wallet-"));
  try {
    run(join(dir, "wallet.json"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("гаманець зберігається у файл і завантажується назад", () => {
  withTempFile((file) => {
    const wallet = generateWallet();
    saveWallet(wallet, file);
    assert.deepEqual(loadWallet(file), wallet);
  });
});

test("loadOrCreateWallet: створює гаманець, якщо файлу немає, і повертає той самий при повторному виклику", () => {
  withTempFile((file) => {
    const first = loadOrCreateWallet(file);
    const second = loadOrCreateWallet(file);
    assert.deepEqual(first, second);
  });
});

test("пошкоджений або підроблений файл гаманця відхиляється", () => {
  withTempFile((file) => {
    const wallet = generateWallet();
    const other = generateWallet();

    writeFileSync(file, "не json");
    assert.throws(() => loadWallet(file), /JSON/);

    writeFileSync(file, JSON.stringify({ ...wallet, address: "abc" }));
    assert.throws(() => loadWallet(file), /формат/);

    writeFileSync(file, JSON.stringify({ ...wallet, address: other.address })); // адреса чужа
    assert.throws(() => loadWallet(file), /адреса/i);

    writeFileSync(
      file,
      JSON.stringify({ ...wallet, privateKey: other.privateKey }),
    ); // ключі не пара
    assert.throws(() => loadWallet(file), /парою/);

    saveWallet(wallet, file);
    assert.ok(readFileSync(file, "utf8").includes(wallet.address)); // правильний файл знову читається
    assert.deepEqual(loadWallet(file), wallet);
  });
});
