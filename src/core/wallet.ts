import { generateKeyPairSync } from "node:crypto";
import { sha256 } from "../utils/hash.ts";

// Гаманець: пара ключів Ed25519 і адреса.
// Усі значення зберігаємо як hex-текст (його зручно писати у файл і пересилати мережею),
// а рахуємо завжди від БАЙТІВ (hex-текст -> байти через Buffer.from(..., 'hex')).
export interface Wallet {
  publicKey: string; // 32 байти = 64 hex-символи
  privateKey: string; // 32 байти = 64 hex-символи.
  address: string; // SHA-256 від байтів публічного ключа = 64 hex-символи
}

// Адреса = SHA-256 від БАЙТІВ публічного ключа
export function addressFromPublicKey(publicKeyHex: string): string {
  const keyBytes = Buffer.from(publicKeyHex, "hex"); // hex-текст -> 32 байти
  return sha256(keyBytes);
}

// Створює новий гаманець
export function generateWallet(): Wallet {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");

  // Node віддає ключі у стандартній "упаковці" (формат DER): спочатку кілька службових
  // байтів, що описують тип ключа, а в самому кінці 32 байти самого ключа.
  // Нам потрібні лише ці останні 32 байти
  const publicDer = publicKey.export({ type: "spki", format: "der" });
  const privateDer = privateKey.export({ type: "pkcs8", format: "der" });

  const publicKeyHex = publicDer
    .subarray(publicDer.length - 32)
    .toString("hex");
  const privateKeyHex = privateDer
    .subarray(privateDer.length - 32)
    .toString("hex");

  return {
    publicKey: publicKeyHex,
    privateKey: privateKeyHex,
    address: addressFromPublicKey(publicKeyHex),
  };
}
