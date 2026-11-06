import { Blockchain } from "../src/core/blockchain.ts";
import { blockHash, createBlock } from "../src/core/block.ts";
import { Mempool } from "../src/core/mempool.ts";
import { mineNextBlock } from "../src/core/miner.ts";
import { mineBlock } from "../src/core/pow.ts";
import { createReward } from "../src/core/reward.ts";
import {
  createTransaction,
  transactionSigningBytes,
} from "../src/core/transaction.ts";
import { signBytes } from "../src/utils/signature.ts";
import { generateWallet } from "../src/core/wallet.ts";
import type { Block } from "../src/core/block.ts";
import type { ChainOptions } from "../src/core/blockchain.ts";
import type { Transaction } from "../src/core/transaction.ts";

const options: ChainOptions = {
  genesisDifficulty: 6,
  difficultyParams: {
    retargetInterval: 100,
    targetBlockTimeMs: 10_000,
    minDifficulty: 1,
  },
};

let total = 0;
let repelled = 0;

// Фіксує результат однієї спроби атаки: система мала її відхилити (result.ok === false)
function report(
  attacker: string,
  result: { ok: boolean; reason?: string },
): void {
  total++;
  const wasRepelled = !result.ok;
  if (wasRepelled) repelled++;
  console.log(`  Що зробив зловмисник: ${attacker}`);
  console.log(
    `  Реакція системи:      ${result.ok ? "прийняла (!)" : result.reason}`,
  );
  console.log(
    `  Результат:            ${wasRepelled ? "✔ атаку відбито" : "✖ АТАКА ПРОЙШЛА"}`,
  );
  console.log("");
}

const title = (text: string): void => console.log(`=== ${text} ===`);

const alice = generateWallet();
const bob = generateWallet();
const miner = generateWallet();
const mallory = generateWallet(); // зловмисник

const chain = new Blockchain(options);
const pool = new Mempool(chain);
function mineAndAdd(minerAddress: string): Block {
  const block = mineNextBlock(chain, pool, minerAddress);
  const result = chain.addBlock(block);
  if (!result.ok) throw new Error(`Чесний блок не пройшов: ${result.reason}`);
  pool.revalidate();
  return block;
}
mineAndAdd(alice.address); // блок 1: Аліса отримує 50
const honestTx = createTransaction(alice, bob.address, 10, 2, 0);
pool.add(honestTx);
mineAndAdd(miner.address); // блок 2: переказ Аліса -> Боб 10
mineAndAdd(miner.address); // блок 3

console.log("=== Підготовка ===");
console.log(
  `Чесний ланцюг: ${chain.length} блоки (генезис і 3 блоки), баланс Аліси ${chain.getBalance(alice.address)}, Боба ${chain.getBalance(bob.address)}`,
);
console.log(
  "Повна перевірка чесного ланцюга:",
  Blockchain.fromBlocks(JSON.parse(JSON.stringify(chain.blocks)), options).ok
    ? "ланцюг коректний"
    : "ПОМИЛКА",
);
console.log("");

const copyOfChain = (): Block[] =>
  JSON.parse(JSON.stringify(chain.blocks)) as Block[];

// Збирає блок із довільними транзакціями і майнить його (для атак, де зловмисник сам складає блок)
function craftBlock(minerAddress: string, regular: Transaction[]): Block {
  const base = createBlock({
    index: chain.lastBlock.header.index + 1,
    timestamp: Date.now(),
    previousHash: blockHash(chain.lastBlock.header),
    difficulty: chain.getNextDifficulty(),
    transactions: [createReward(minerAddress, regular), ...regular],
  });
  return mineBlock(base);
}

// --- Атака 1 ---
title("Атака 1. Зміна суми в транзакції старого блоку");
{
  const blocks = copyOfChain();
  const tx = (blocks[2] as Block).transactions[1] as Transaction;
  const before = tx.amount;
  tx.amount = 1000;
  const result = Blockchain.fromBlocks(blocks, options);
  report(
    `у блоці №2 змінив суму переказу Аліса -> Боб з ${before} на 1000 і запустив перевірку ланцюга`,
    result.ok ? { ok: true } : result,
  );
}

// --- Атака 2 ---
title("Атака 2. Зміна даних із перерахунком хешу цього ж блоку");
{
  const blocks = copyOfChain();
  const original = blocks[2] as Block;
  // Зловмисник підміняє адресу майнера у винагороді (це поле не підписане), перераховує корінь Меркла
  // і заново майнить блок №2, тож сам блок виглядає цілком правильним.
  const stolen = {
    ...(original.transactions[0] as object),
    to: mallory.address,
  };
  blocks[2] = mineBlock(
    createBlock({
      index: original.header.index,
      timestamp: original.header.timestamp,
      previousHash: original.header.previousHash,
      difficulty: original.header.difficulty,
      transactions: [stolen as never, ...original.transactions.slice(1)],
    }),
  );
  const alone = Blockchain.fromBlocks(blocks.slice(0, 3), options); // ланцюг лише до зміненого блоку
  console.log(
    `  (сам змінений блок №2 перевірку проходить: ${alone.ok ? "так" : "ні, " + alone.reason})`,
  );
  const result = Blockchain.fromBlocks(blocks, options);
  report(
    "у блоці №2 підмінив адресу майнера, перерахував корінь Меркла і перемайнив цей блок, щоб його хеш був правильним",
    result.ok ? { ok: true } : result,
  );
}

// --- Атака 3 ---
title("Атака 3. Транзакція з підробленим підписом");
{
  // 3а. Мелорі пише адресу Аліси у полі "від кого", але підписує своїм ключем
  const body = {
    from: alice.address,
    publicKey: mallory.publicKey,
    to: mallory.address,
    amount: 40,
    fee: 1,
    nonce: 1,
  };
  const forgedA = {
    ...body,
    signature: signBytes(transactionSigningBytes(body), mallory.privateKey),
  };
  report(
    'надіслав у мемпул транзакцію "від Аліси" (її адреса), підписану ключем зловмисника',
    pool.add(forgedA),
  );

  // 3б. Бере справжню транзакцію Аліси і змінює суму, залишивши її підпис
  const stolenSignature = {
    ...createTransaction(alice, bob.address, 5, 1, 1),
    amount: 45,
  };
  report(
    "узяв справжню підписану транзакцію Аліси і підмінив у ній суму з 5 на 45",
    pool.add(stolenSignature),
  );

  // 3в. Те саме, але зловмисник сам складає блок із такою транзакцією
  report(
    "сам намайнив блок, у який вклав підроблену транзакцію, і надіслав його вузлу",
    chain.addBlock(craftBlock(mallory.address, [forgedA])),
  );
}

// --- Атака 4 ---
title("Атака 4. Подвійна витрата (дві транзакції, кожна на весь баланс)");
{
  const balance = chain.getBalance(alice.address);
  const first = createTransaction(alice, bob.address, balance - 1, 1, 1); // на весь баланс разом з комісією
  const second = createTransaction(alice, mallory.address, balance - 1, 1, 2); // ще раз на весь баланс
  console.log(
    `  (баланс Аліси ${balance}; кожна транзакція витрачає ${balance} разом з комісією)`,
  );
  console.log(
    `  Перша транзакція в мемпулі: ${pool.add(first).ok ? "прийнята" : "відхилена"}`,
  );
  report(
    "одразу після неї надіслав другу транзакцію на весь той самий баланс",
    pool.add(second),
  );
  report(
    "сам намайнив блок із обома транзакціями одразу",
    chain.addBlock(craftBlock(mallory.address, [first, second])),
  );
}

// --- Атака 5 ---
title("Атака 5. Повторне надсилання вже підтвердженої транзакції");
{
  pool.rebuild([]); // очищаємо мемпул від попередньої атаки, щоб повідомлення було про саму цю атаку
  console.log(
    "  (транзакція Аліси з nonce 0 уже підтверджена: вона лежить у блоці №2 ланцюга)",
  );
  report(
    "надіслав у мемпул ту саму підтверджену транзакцію ще раз",
    pool.add(honestTx),
  );
  report(
    "сам намайнив блок, у який знову вклав цю транзакцію",
    chain.addBlock(craftBlock(mallory.address, [honestTx])),
  );
}

console.log("=== Підсумок ===");
console.log(`Спроб атак: ${total}, відбито: ${repelled}`);
console.log(
  repelled === total ? "Система відбила усі атаки" : "Є атаки, які пройшли",
);
process.exitCode = repelled === total ? 0 : 1;
