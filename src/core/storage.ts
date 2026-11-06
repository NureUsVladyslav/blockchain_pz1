import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { Blockchain } from "./blockchain.ts";
import type { ChainOptions } from "./blockchain.ts";

// Зберігає ланцюг у JSON-файл. Спочатку пишемо у тимчасовий файл і лише потім перейменовуємо,
// щоб при збої посеред запису не лишився наполовину записаний файл.
export function saveChain(chain: Blockchain, filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(chain.blocks), "utf8");
  renameSync(tmpPath, filePath);
}

// Завантажує ланцюг із файлу. Файлу не довіряємо: усі блоки проходять повну перевірку.
// Якщо файлу немає, повертаємо новий ланцюг з одним генезис-блоком.
// Якщо файл пошкоджений або підроблений, кидаємо помилку: вузол не повинен стартувати з неправильним ланцюгом.
export function loadChain(
  filePath: string,
  options: ChainOptions = {},
): Blockchain {
  if (!existsSync(filePath)) return new Blockchain(options);

  let data: unknown;
  try {
    data = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    throw new Error("Файл ланцюга пошкоджений: це не коректний JSON");
  }

  const result = Blockchain.fromBlocks(data, options);
  if (!result.ok)
    throw new Error(`Файл ланцюга не пройшов перевірку: ${result.reason}`);
  return result.chain;
}
