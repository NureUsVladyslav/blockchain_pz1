import {
  MIN_DIFFICULTY,
  RETARGET_INTERVAL,
  TARGET_BLOCK_TIME_MS,
} from "../config.ts";
import type { BlockHeader } from "./block.ts";

export interface DifficultyParams {
  retargetInterval: number; // K: кожні K блоків коригуємо складність
  targetBlockTimeMs: number; // бажаний середній час блоку
  minDifficulty: number; // нижня межа складності
}

export const DEFAULT_PARAMS: DifficultyParams = {
  retargetInterval: RETARGET_INTERVAL,
  targetBlockTimeMs: TARGET_BLOCK_TIME_MS,
  minDifficulty: MIN_DIFFICULTY,
};

// Яка складність має бути у НАСТУПНОГО блоку, якщо в ланцюгу вже є блоки з такими заголовками
// (від генезис-блоку по порядку). Цю функцію викликає і майнер, і перевірка чужих блоків.
//
// Складність постійна всередині "епохи" з K блоків: блоки 1..K, K+1..2K і так далі (генезис не рахуємо).
// Перед першим блоком нової епохи дивимось, скільки часу пішло на блоки попередньої епохи:
//   швидше за бажане: складність +1 біт; повільніше: складність -1 біт; рівно: без змін.
export function nextDifficulty(
  headers: BlockHeader[],
  params: DifficultyParams = DEFAULT_PARAMS,
): number {
  const K = params.retargetInterval;
  if (!Number.isSafeInteger(K) || K < 2)
    throw new Error("retargetInterval має бути цілим числом не менше 2");
  if (headers.length === 0) throw new Error("Потрібен хоча б генезис-блок");

  const nextIndex = headers.length;
  const last = headers[nextIndex - 1] as BlockHeader;

  // Коригуємо лише перед першим блоком нової епохи (індекси K+1, 2K+1, ...)
  const isFirstBlockOfEpoch = nextIndex > K && (nextIndex - 1) % K === 0;
  if (!isFirstBlockOfEpoch) return last.difficulty;

  const first = headers[nextIndex - K] as BlockHeader; // перший блок попередньої епохи
  const actualTime = last.timestamp - first.timestamp; // між першим і останнім блоком епохи K-1 проміжків
  const expectedTime = (K - 1) * params.targetBlockTimeMs;

  if (actualTime < expectedTime) return last.difficulty + 1;
  if (actualTime > expectedTime)
    return Math.max(params.minDifficulty, last.difficulty - 1);
  return last.difficulty;
}
