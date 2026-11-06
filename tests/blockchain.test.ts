import { test } from "node:test";
import assert from "node:assert/strict";
import { Blockchain, createGenesisBlock } from "../src/core/blockchain.ts";
import { Mempool } from "../src/core/mempool.ts";
import { mineNextBlock } from "../src/core/miner.ts";
import { generateWallet } from "../src/core/wallet.ts";
import { createTransaction } from "../src/core/transaction.ts";
import { createBlock, blockHash } from "../src/core/block.ts";
import { createReward } from "../src/core/reward.ts";
import { meetsDifficulty, mineBlock } from "../src/core/pow.ts";
import { BLOCK_REWARD } from "../src/config.ts";
import type { Block, BlockHeader } from "../src/core/block.ts";
import type { ChainOptions } from "../src/core/blockchain.ts";
import type { Transaction } from "../src/core/transaction.ts";

// Малі параметри, щоб майнінг у тестах був миттєвим
const options: ChainOptions = {
  genesisDifficulty: 4,
  difficultyParams: {
    retargetInterval: 3,
    targetBlockTimeMs: 10_000,
    minDifficulty: 1,
  },
};

function setup() {
  const chain = new Blockchain(options);
  const pool = new Mempool(chain);
  return { chain, pool };
}

// Майнить наступний блок з мемпулу, додає його в ланцюг і оновлює мемпул
function mineAndAdd(
  chain: Blockchain,
  pool: Mempool,
  minerAddress: string,
): Block {
  const block = mineNextBlock(chain, pool, minerAddress);
  assert.deepEqual(chain.addBlock(block), { ok: true });
  pool.revalidate();
  return block;
}

// Збирає блок із довільними звичайними транзакціями (для негативних тестів).
// override підміняє поля заголовка; mine = false залишає блок не намайненим.
function craftBlock(
  chain: Blockchain,
  minerAddress: string,
  regular: Transaction[],
  override: Partial<BlockHeader> = {},
  mine = true,
): Block {
  const base = createBlock({
    index: chain.lastBlock.header.index + 1,
    timestamp: Date.now(),
    previousHash: blockHash(chain.lastBlock.header),
    difficulty: chain.getNextDifficulty(),
    transactions: [createReward(minerAddress, regular), ...regular],
  });
  const block = { ...base, header: { ...base.header, ...override } };
  return mine ? mineBlock(block) : block;
}

function reasonOf(result: { ok: boolean; reason?: string }): string {
  assert.equal(result.ok, false);
  return result.reason ?? "";
}

test("генезис-блок однаковий у всіх вузлів і не містить транзакцій", () => {
  const a = new Blockchain(options);
  const b = new Blockchain(options);

  assert.equal(blockHash(a.lastBlock.header), blockHash(b.lastBlock.header));
  assert.equal(a.length, 1);
  assert.equal(a.lastBlock.header.index, 0);
  assert.deepEqual(a.lastBlock.transactions, []);
  assert.deepEqual(createGenesisBlock(4), a.lastBlock);
});

test("намайнений блок додається, майнер отримує винагороду", () => {
  const { chain, pool } = setup();
  const miner = generateWallet();
  mineAndAdd(chain, pool, miner.address);

  assert.equal(chain.length, 2);
  assert.equal(chain.getBalance(miner.address), BLOCK_REWARD);
});

test("переказ з комісією: баланси відправника, отримувача і майнера сходяться", () => {
  const { chain, pool } = setup();
  const alice = generateWallet();
  const bob = generateWallet();
  const miner = generateWallet();

  mineAndAdd(chain, pool, alice.address); // Аліса отримала 50
  assert.deepEqual(pool.add(createTransaction(alice, bob.address, 10, 2, 0)), {
    ok: true,
  });
  mineAndAdd(chain, pool, miner.address);

  assert.equal(chain.getBalance(alice.address), BLOCK_REWARD - 10 - 2);
  assert.equal(chain.getBalance(bob.address), 10);
  assert.equal(chain.getBalance(miner.address), BLOCK_REWARD + 2); // винагорода плюс комісія
  assert.equal(chain.getNextNonce(alice.address), 1);
  assert.equal(pool.size, 0); // транзакція вже в блоці і з черги зникла
});

test("мемпул використовує реальний ланцюг: без коштів відхиляє, після винагороди приймає", () => {
  const { chain, pool } = setup();
  const alice = generateWallet();
  const bob = generateWallet();

  const before = pool.add(createTransaction(alice, bob.address, 5, 1, 0));
  assert.equal(before.ok, false);
  mineAndAdd(chain, pool, alice.address);
  assert.deepEqual(pool.add(createTransaction(alice, bob.address, 5, 1, 0)), {
    ok: true,
  });
});

test("блок з неправильними полями заголовка відхиляється", () => {
  const { chain } = setup();
  const miner = generateWallet();

  assert.match(
    reasonOf(
      chain.addBlock(
        craftBlock(chain, miner.address, [], { previousHash: "f".repeat(64) }),
      ),
    ),
    /previousHash/,
  );
  assert.match(
    reasonOf(
      chain.addBlock(craftBlock(chain, miner.address, [], { index: 5 })),
    ),
    /номер/,
  );
  assert.match(
    reasonOf(
      chain.addBlock(
        craftBlock(chain, miner.address, [], {
          difficulty: chain.getNextDifficulty() + 1,
        }),
      ),
    ),
    /складність/i,
  );

  // Не намайнений блок: беремо nonce, при якому хеш точно не підходить
  const unmined = craftBlock(chain, miner.address, [], {}, false);
  let nonce = 0;
  while (meetsDifficulty({ ...unmined.header, nonce })) nonce++;
  const bad = { ...unmined, header: { ...unmined.header, nonce } };
  assert.match(reasonOf(chain.addBlock(bad)), /Proof of Work/);

  assert.equal(chain.length, 1); // нічого не додалося
  assert.deepEqual(chain.addBlock(craftBlock(chain, miner.address, [])), {
    ok: true,
  }); // правильний проходить
});

test("правила транзакцій у блоці: підпис, баланс, порядок nonce, повтор підтвердженої", () => {
  const { chain, pool } = setup();
  const alice = generateWallet();
  const bob = generateWallet();
  const miner = generateWallet();
  mineAndAdd(chain, pool, alice.address); // у Аліси 50

  // Підроблена сума: підпис більше не підходить
  const tampered = {
    ...createTransaction(alice, bob.address, 5, 1, 0),
    amount: 6,
  };
  assert.match(
    reasonOf(chain.addBlock(craftBlock(chain, miner.address, [tampered]))),
    /Підпис/,
  );

  // Витрата більше, ніж є
  assert.match(
    reasonOf(
      chain.addBlock(
        craftBlock(chain, miner.address, [
          createTransaction(alice, bob.address, 100, 1, 0),
        ]),
      ),
    ),
    /коштів/,
  );

  // Неправильний nonce (очікується 0)
  assert.match(
    reasonOf(
      chain.addBlock(
        craftBlock(chain, miner.address, [
          createTransaction(alice, bob.address, 5, 1, 1),
        ]),
      ),
    ),
    /nonce/,
  );

  // Подвійна витрата в одному блоці: кожна транзакція окремо дозволена, а разом перевищують баланс
  const first = createTransaction(alice, bob.address, 30, 1, 0);
  const second = createTransaction(alice, bob.address, 30, 1, 1);
  assert.match(
    reasonOf(chain.addBlock(craftBlock(chain, miner.address, [first, second]))),
    /коштів/,
  );

  // Нормальна транзакція проходить, а її повторне надсилання в наступному блоці відхиляється через nonce
  const ok = createTransaction(alice, bob.address, 5, 1, 0);
  assert.deepEqual(chain.addBlock(craftBlock(chain, miner.address, [ok])), {
    ok: true,
  });
  assert.match(
    reasonOf(chain.addBlock(craftBlock(chain, miner.address, [ok]))),
    /nonce/,
  );
});

test("атаки на ланцюг: будь-яка зміна вже доданого блоку виявляється", () => {
  const { chain, pool } = setup();
  const alice = generateWallet();
  const bob = generateWallet();
  const miner = generateWallet();

  mineAndAdd(chain, pool, alice.address);
  pool.add(createTransaction(alice, bob.address, 10, 2, 0));
  mineAndAdd(chain, pool, miner.address);
  mineAndAdd(chain, pool, miner.address);

  const clone = (): Block[] =>
    JSON.parse(JSON.stringify(chain.blocks)) as Block[];
  assert.equal(Blockchain.fromBlocks(clone(), options).ok, true); // цілий ланцюг проходить

  // 1. Зміна суми в транзакції старого блоку
  const changedAmount = clone();
  (changedAmount[2]!.transactions[1] as Transaction).amount = 1000;
  assert.equal(Blockchain.fromBlocks(changedAmount, options).ok, false);

  // 2. Зміна даних блоку з перерахунком його кореня Меркла і хешу (перемайнили): рветься зв'язок з наступним
  const rewritten = clone();
  const original = rewritten[1]!;
  const stolenReward = {
    ...(original.transactions[0] as object),
    to: generateWallet().address,
  };
  rewritten[1] = mineBlock(
    createBlock({
      index: original.header.index,
      timestamp: original.header.timestamp,
      previousHash: original.header.previousHash,
      difficulty: original.header.difficulty,
      transactions: [stolenReward as never],
    }),
  );
  const r2 = Blockchain.fromBlocks(rewritten, options);
  assert.equal(r2.ok, false);
  if (!r2.ok) {
    assert.match(r2.reason, /Блок №2/);
    assert.match(r2.reason, /previousHash/);
  }

  // 3. Видалений блок усередині ланцюга
  const removed = clone();
  removed.splice(2, 1);
  assert.equal(Blockchain.fromBlocks(removed, options).ok, false);

  // 4. Інший генезис-блок
  const otherGenesis = clone();
  otherGenesis[0] = createGenesisBlock(5);
  assert.match(
    reasonOf(Blockchain.fromBlocks(otherGenesis, options)),
    /генезис/,
  );

  // 5. Сміття замість ланцюга
  assert.equal(Blockchain.fromBlocks(null, options).ok, false);
  assert.equal(Blockchain.fromBlocks([], options).ok, false);
});

test("selectTransactions і revalidate прибирають транзакції, що стали недійсними", () => {
  const { chain, pool } = setup();
  const alice = generateWallet();
  const bob = generateWallet();
  const carol = generateWallet();
  const miner = generateWallet();
  mineAndAdd(chain, pool, alice.address);

  // У мемпулі лежить переказ Бобу, а в ланцюг тим часом потрапляє інший переказ з тим самим nonce (подвійна витрата)
  const waiting = createTransaction(alice, bob.address, 5, 1, 0);
  assert.deepEqual(pool.add(waiting), { ok: true });
  const conflicting = createTransaction(alice, carol.address, 7, 1, 0);
  assert.deepEqual(
    chain.addBlock(craftBlock(chain, miner.address, [conflicting])),
    { ok: true },
  );

  assert.deepEqual(chain.selectTransactions(pool.getAll()), []); // застаріла транзакція пропущена
  pool.revalidate();
  assert.equal(pool.size, 0); // і з мемпулу прибрана
});
