export const BLOCK_REWARD = 50; // фіксована винагорода майнеру за блок
export const TARGET_BLOCK_TIME_MS = 10_000; // бажаний середній час блоку: 10 секунд
export const RETARGET_INTERVAL = 10; // K: кожні K блоків коригуємо складність
export const INITIAL_DIFFICULTY = 16; // складність генезис-блоку (кількість нульових бітів)
export const MIN_DIFFICULTY = 1; // складність не може впасти нижче
export const GENESIS_TIMESTAMP = 1_700_000_000_000; // фіксована мітка часу генезис-блоку (однакова у всіх вузлів)
