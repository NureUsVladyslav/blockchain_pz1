import {
  INITIAL_DIFFICULTY,
  MIN_DIFFICULTY,
  RETARGET_INTERVAL,
  TARGET_BLOCK_TIME_MS,
} from "../config.ts";
import type { ChainOptions } from "../core/blockchain.ts";

// Читає число зі змінної оточення; якщо її немає, повертає значення за замовчуванням
export function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`Змінна ${name} має бути цілим числом, отримано: ${raw}`);
  return value;
}

// Параметри ланцюга зі змінних оточення. Мають бути однаковими в усіх вузлах мережі (і в консольної утиліти),
// інакше генезис-блоки різні, і вузли не зрозуміють один одного.
export function chainOptionsFromEnv(): ChainOptions {
  return {
    genesisDifficulty: numberEnv("GENESIS_DIFFICULTY", INITIAL_DIFFICULTY),
    difficultyParams: {
      retargetInterval: numberEnv("RETARGET_INTERVAL", RETARGET_INTERVAL),
      targetBlockTimeMs: numberEnv(
        "TARGET_BLOCK_TIME_MS",
        TARGET_BLOCK_TIME_MS,
      ),
      minDifficulty: MIN_DIFFICULTY,
    },
  };
}
