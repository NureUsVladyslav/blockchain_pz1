import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isHex } from "../utils/hex.ts";
import { isObject } from "../utils/object.ts";
import { signBytes, verifyBytes } from "../utils/signature.ts";
import { addressFromPublicKey, generateWallet } from "./wallet.ts";
import type { Wallet } from "./wallet.ts";

// Зберігає гаманець у JSON-файл
export function saveWallet(wallet: Wallet, filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(wallet, null, 2), "utf8");
}

// Завантажує гаманець і перевіряє, що файл не пошкоджений: формат, адреса відповідає ключу,
// приватний і публічний ключі справді парні
export function loadWallet(filePath: string): Wallet {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    throw new Error(`Файл гаманця ${filePath} не вдалося прочитати як JSON`);
  }
  if (
    !isObject(data) ||
    !isHex(data.publicKey, 32) ||
    !isHex(data.privateKey, 32) ||
    !isHex(data.address, 32)
  ) {
    throw new Error("Файл гаманця має неправильний формат");
  }
  const wallet: Wallet = {
    publicKey: data.publicKey,
    privateKey: data.privateKey,
    address: data.address,
  };

  if (addressFromPublicKey(wallet.publicKey) !== wallet.address) {
    throw new Error("Адреса в файлі гаманця не відповідає публічному ключу");
  }
  const probe = Buffer.from("перевірка ключів", "utf8");
  if (
    !verifyBytes(probe, signBytes(probe, wallet.privateKey), wallet.publicKey)
  ) {
    throw new Error("Приватний і публічний ключі у файлі гаманця не є парою");
  }
  return wallet;
}

// Якщо файл є, завантажує його, інакше створює новий гаманець і зберігає
export function loadOrCreateWallet(filePath: string): Wallet {
  if (existsSync(filePath)) return loadWallet(filePath);
  const wallet = generateWallet();
  saveWallet(wallet, filePath);
  return wallet;
}
