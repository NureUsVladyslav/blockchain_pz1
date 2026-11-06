import { sign, verify, createPrivateKey, createPublicKey } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { isHex } from "./hex.ts";

// Node приймає ключі у стандартній "упаковці" (DER). Ми зберігаємо лише 32 байти самого ключа,
// тому перед використанням дописуємо спереду службовий заголовок.
// Заголовки однакові для всіх ключів Ed25519.
const PKCS8_HEADER = Buffer.from("302e020100300506032b657004220420", "hex"); // приватний ключ, 16 байтів
const SPKI_HEADER = Buffer.from("302a300506032b6570032100", "hex"); // публічний ключ, 12 байтів

const KEY_BYTES = 32; // довжина ключа Ed25519
const SIGNATURE_BYTES = 64; // довжина підпису Ed25519

function privateKeyFromHex(privateKeyHex: string): KeyObject {
  const der = Buffer.concat([PKCS8_HEADER, Buffer.from(privateKeyHex, "hex")]);
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

function publicKeyFromHex(publicKeyHex: string): KeyObject {
  const der = Buffer.concat([SPKI_HEADER, Buffer.from(publicKeyHex, "hex")]);
  return createPublicKey({ key: der, format: "der", type: "spki" });
}

// Підписує байти приватним ключем. Повертає підпис як hex (64 байти = 128 символів).
// Якщо приватний ключ некоректний, це помилка програміста, тому кидаємо виняток.
export function signBytes(data: Uint8Array, privateKeyHex: string): string {
  if (!isHex(privateKeyHex, KEY_BYTES)) {
    throw new Error("Приватний ключ має бути рядком із 64 hex-символів");
  }
  // Перший аргумент null: у Ed25519 алгоритм вшитий у сам тип ключа
  const signature = sign(null, data, privateKeyFromHex(privateKeyHex));
  return signature.toString("hex");
}

// Перевіряє підпис. Повертає true або false
export function verifyBytes(
  data: Uint8Array,
  signatureHex: string,
  publicKeyHex: string,
): boolean {
  if (
    !isHex(signatureHex, SIGNATURE_BYTES) ||
    !isHex(publicKeyHex, KEY_BYTES)
  ) {
    return false;
  }
  try {
    return verify(
      null,
      data,
      publicKeyFromHex(publicKeyHex),
      Buffer.from(signatureHex, "hex"),
    );
  } catch {
    return false;
  }
}
