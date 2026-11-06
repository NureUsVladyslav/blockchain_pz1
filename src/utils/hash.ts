import { createHash } from "node:crypto";

// SHA-256: приймає рядок (кодується як UTF-8) або байти.
// Повертає хеш як hex-рядок із 64 символів.

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}
