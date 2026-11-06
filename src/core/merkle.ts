import { createHash } from "node:crypto";
import { sha256 } from "../utils/hash.ts";
import { isHex } from "../utils/hex.ts";
import { isObject } from "../utils/object.ts";

// Крок доказу Меркла: хеш сусіднього вузла і те, з якого боку він стоїть відносно нашого
export interface MerkleProofStep {
  hash: string;
  position: "left" | "right";
}

function checkLeaves(leafHashes: string[]): void {
  for (const leaf of leafHashes) {
    if (!isHex(leaf, 32)) {
      throw new Error("Листок дерева Меркла має бути хешем із 64 hex-символів");
    }
  }
}

// Наступний рівень дерева: хеші сусідніх пар. Якщо пари немає, останній хеш дублюється.
function nextLevel(level: string[]): string[] {
  const next: string[] = [];
  for (let i = 0; i < level.length; i += 2) {
    const left = level[i] as string;
    const right = level[i + 1] ?? left; // немає пари: дублюємо останній
    next.push(hashPair(left, right));
  }
  return next;
}

// Корінь Меркла для списку хешів (кожен хеш це 64 hex-символи).
//
// Правила:
//  - хеш пари = SHA-256 від БАЙТІВ двох хешів, склеєних разом (32 + 32 = 64 байти);
//  - якщо на рівні непарна кількість хешів, останній дублюється;
//  - один хеш: корінь дорівнює йому самому;
//  - порожній список: корінь це SHA-256 від порожніх даних.
export function merkleRoot(leafHashes: string[]): string {
  checkLeaves(leafHashes);
  if (leafHashes.length === 0) return sha256("");

  let level = leafHashes;
  while (level.length > 1) level = nextLevel(level);
  return level[0] as string;
}

// Доказ того, що листок з номером index входить у дерево: хеші-сусіди на шляху від листка до кореня.
// Для списку з N листків у доказі близько log2(N) хешів, а не N.
export function merkleProof(
  leafHashes: string[],
  index: number,
): MerkleProofStep[] {
  checkLeaves(leafHashes);
  if (!Number.isInteger(index) || index < 0 || index >= leafHashes.length) {
    throw new Error("Номер листка поза межами списку");
  }

  const proof: MerkleProofStep[] = [];
  let level = leafHashes;
  let i = index;
  while (level.length > 1) {
    const isLeft = i % 2 === 0; // ми лівий чи правий у парі
    const sibling =
      (isLeft ? level[i + 1] : level[i - 1]) ?? (level[i] as string); // немає пари: сусід це ми самі
    proof.push({ hash: sibling, position: isLeft ? "right" : "left" });
    level = nextLevel(level);
    i = Math.floor(i / 2);
  }
  return proof;
}

// Перевіряє доказ: з листка, піднімаючись угору і склеюючи з сусідами, має вийти відомий корінь.
// Приймає unknown, бо доказ приходить із мережі; ніколи не кидає виняток.
export function verifyMerkleProof(
  leafHash: string,
  proof: unknown,
  root: string,
): boolean {
  if (!isHex(leafHash, 32) || !isHex(root, 32) || !Array.isArray(proof))
    return false;

  let current = leafHash;
  for (const step of proof as unknown[]) {
    if (!isObject(step) || !isHex(step.hash, 32)) return false;
    if (step.position === "left") current = hashPair(step.hash, current);
    else if (step.position === "right") current = hashPair(current, step.hash);
    else return false;
  }
  return current === root;
}

// SHA-256 від склеєних БАЙТІВ двох хешів (не від їхнього hex-тексту)
function hashPair(left: string, right: string): string {
  const bytes = Buffer.concat([
    Buffer.from(left, "hex"),
    Buffer.from(right, "hex"),
  ]);
  return createHash("sha256").update(bytes).digest("hex");
}
