import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Node } from "../src/node/node.ts";
import { blockHash } from "../src/core/block.ts";
import { generateWallet } from "../src/core/wallet.ts";
import { createTransaction, transactionId } from "../src/core/transaction.ts";
import type { Transport } from "../src/node/node.ts";
import type { ChainOptions } from "../src/core/blockchain.ts";
import type { Wallet } from "../src/core/wallet.ts";

// Малі параметри, щоб майнінг у тестах був миттєвим
const options: ChainOptions = {
  genesisDifficulty: 4,
  difficultyParams: {
    retargetInterval: 100,
    targetBlockTimeMs: 10_000,
    minDifficulty: 1,
  },
};

// Віртуальна мережа в одному процесі: "надсилання" це прямий виклик методів іншого вузла
class VirtualNetwork {
  nodes = new Map<string, Node>();
  sentTransactions = 0;
  sentBlocks = 0;

  #get(url: string): Node {
    const node = this.nodes.get(url);
    if (!node) throw new Error(`Невідомий вузол ${url}`);
    return node;
  }

  transport: Transport = {
    sendTransaction: async (to, from, tx) => {
      this.sentTransactions++;
      await this.#get(to).receiveTransaction(tx, from);
    },
    sendBlock: async (to, from, block) => {
      this.sentBlocks++;
      await this.#get(to).receiveBlock(block, from);
    },
    fetchChain: async (to) => this.#get(to).serveChain(),
  };
}

interface TestNode {
  node: Node;
  wallet: Wallet;
}

// Створює вузли a, b, c... і з'єднує кожного з кожним
function createNetwork(
  names: string[],
  storagePaths: Record<string, string> = {},
) {
  const net = new VirtualNetwork();
  const nodes: Record<string, TestNode> = {};
  for (const name of names) {
    const wallet = generateWallet();
    const node = new Node({
      url: `http://${name}`,
      minerAddress: wallet.address,
      transport: net.transport,
      chainOptions: options,
      ...(storagePaths[name] ? { storagePath: storagePaths[name] } : {}),
    });
    net.nodes.set(node.url, node);
    nodes[name] = { node, wallet };
  }
  for (const a of Object.values(nodes)) {
    for (const b of Object.values(nodes)) a.node.addPeer(b.node.url);
  }
  return { net, nodes };
}

const tip = (n: TestNode): string => blockHash(n.node.chain.lastBlock.header);

test("блок, знайдений одним вузлом, і транзакція доходять до всіх вузлів", async () => {
  const { nodes } = createNetwork(["a", "b", "c"]);
  const a = nodes["a"] as TestNode,
    b = nodes["b"] as TestNode,
    c = nodes["c"] as TestNode;
  const bob = generateWallet();

  await a.node.mine(); // у Аліси (вузол a) 50
  assert.equal(b.node.chain.length, 2);
  assert.equal(c.node.chain.length, 2);

  const tx = createTransaction(a.wallet, bob.address, 10, 2, 0);
  assert.deepEqual(await a.node.submitTransaction(tx), { ok: true });
  for (const n of [a, b, c])
    assert.equal(n.node.mempool.has(transactionId(tx)), true);

  await b.node.mine(); // блок із переказом знаходить інший вузол
  for (const n of [a, b, c]) {
    assert.equal(n.node.chain.length, 3);
    assert.equal(n.node.chain.getBalance(bob.address), 10);
    assert.equal(n.node.mempool.size, 0);
    assert.equal(tip(n), tip(a));
  }
});

test("розсилка не зациклюється: кожен вузол пересилає транзакцію не більше одного разу", async () => {
  const { net, nodes } = createNetwork(["a", "b", "c"]);
  const a = nodes["a"] as TestNode;
  await a.node.mine();

  net.sentTransactions = 0;
  await a.node.submitTransaction(
    createTransaction(a.wallet, generateWallet().address, 5, 1, 0),
  );
  assert.ok(net.sentTransactions >= 2);
  assert.ok(
    net.sentTransactions <= 6,
    `надіслано ${net.sentTransactions} повідомлень, це забагато`,
  );
});

test("форк: вузол переходить на ланцюг з більшою роботою, транзакції програшного блоку повертаються в мемпул", async () => {
  const { nodes } = createNetwork(["a", "b", "c"]);
  const a = nodes["a"] as TestNode,
    b = nodes["b"] as TestNode,
    c = nodes["c"] as TestNode;
  const bob = generateWallet();

  await a.node.mine(); // спільний блок №1, у Аліси 50
  c.node.setOnline(false); // C відключено: мережа розділилась

  // A і B живуть без C: переказ потрапляє в блок №2 їхньої гілки
  const tx = createTransaction(a.wallet, bob.address, 10, 2, 0);
  await a.node.submitTransaction(tx);
  await a.node.mine();
  assert.equal(a.node.chain.length, 3);
  assert.equal(b.node.chain.length, 3);
  assert.equal(c.node.chain.length, 2);

  // C за цей час намайнив два блоки (більше роботи) без цього переказу
  await c.node.mine();
  await c.node.mine();
  assert.equal(c.node.chain.length, 4);
  assert.ok(c.node.chain.totalWork > a.node.chain.totalWork);

  // C повертається в мережу, A синхронізується з ним
  c.node.setOnline(true);
  const result = await a.node.syncWith(c.node.url);
  assert.deepEqual(result, {
    ok: true,
    adopted: true,
    orphanedBlocks: 1,
    returnedTransactions: 1,
  });

  // Усі вузли на одному ланцюгу, B теж перейшов (отримав новий кінець ланцюга від A)
  for (const n of [a, b, c]) assert.equal(tip(n), tip(c));
  assert.equal(a.node.chain.length, 4);

  // Транзакція не зникла: вона знову в мемпулі A і B і потрапить у наступний блок
  assert.equal(a.node.mempool.has(transactionId(tx)), true);
  assert.equal(b.node.mempool.has(transactionId(tx)), true);
  assert.equal(a.node.chain.getBalance(bob.address), 0);

  await b.node.mine();
  for (const n of [a, b, c])
    assert.equal(n.node.chain.getBalance(bob.address), 10);
});

test("при рівній роботі вузол лишається на своєму ланцюгу", async () => {
  const { nodes } = createNetwork(["a", "c"]);
  const a = nodes["a"] as TestNode,
    c = nodes["c"] as TestNode;
  await a.node.mine();

  c.node.setOnline(false);
  await a.node.mine(); // у A блок №2
  await c.node.mine(); // у C теж блок №2 (інший), роботи порівну
  c.node.setOnline(true);

  const before = tip(a);
  const result = await a.node.syncWith(c.node.url);
  assert.deepEqual(result, {
    ok: true,
    adopted: false,
    orphanedBlocks: 0,
    returnedTransactions: 0,
  });
  assert.equal(tip(a), before);
  assert.notEqual(tip(a), tip(c)); // гілки різні, ніхто не поступився
});

test("недійсний ланцюг сусіда відхиляється, свій ланцюг не змінюється", async () => {
  const wallet = generateWallet();
  const donor = new Node({
    url: "http://donor",
    minerAddress: wallet.address,
    transport: {
      sendTransaction: async () => {},
      sendBlock: async () => {},
      fetchChain: async () => [],
    },
    chainOptions: options,
  });
  await donor.mine();
  await donor.mine();

  // Сусід віддає довший ланцюг, але з підробленою винагородою в блоці №1
  const forged = JSON.parse(JSON.stringify(donor.chain.blocks)) as {
    transactions: { amount: number }[];
  }[];
  (forged[1]!.transactions[0] as { amount: number }).amount = 1_000_000;

  const victim = new Node({
    url: "http://victim",
    minerAddress: generateWallet().address,
    transport: {
      sendTransaction: async () => {},
      sendBlock: async () => {},
      fetchChain: async () => forged,
    },
    chainOptions: options,
  });
  const result = await victim.syncWith("http://donor");

  assert.equal(result.ok, false);
  assert.equal(victim.chain.length, 1);
});

test("відключений вузол нічого не приймає і не розсилає", async () => {
  const { nodes } = createNetwork(["a", "c"]);
  const a = nodes["a"] as TestNode,
    c = nodes["c"] as TestNode;

  c.node.setOnline(false);
  await a.node.mine();
  assert.equal(c.node.chain.length, 1); // блок до C не дійшов

  const received = await c.node.receiveBlock(
    a.node.chain.lastBlock,
    a.node.url,
  );
  assert.equal(received.ok, false);

  await c.node.mine(); // локально C працює
  assert.equal(c.node.chain.length, 2);
  assert.equal(a.node.chain.length, 2); // але A про це не знає: C нічого не розіслав
  assert.notEqual(tip(a), tip(c));
});

test("новий вузол при підключенні синхронізується з мережею", async () => {
  const { net, nodes } = createNetwork(["a", "b"]);
  const a = nodes["a"] as TestNode;
  await a.node.mine();
  await a.node.mine();

  const wallet = generateWallet();
  const newcomer = new Node({
    url: "http://d",
    minerAddress: wallet.address,
    transport: net.transport,
    chainOptions: options,
  });
  net.nodes.set(newcomer.url, newcomer);
  newcomer.addPeer(a.node.url);

  const results = await newcomer.syncAll();
  assert.equal(results[a.node.url]?.ok, true);
  assert.equal(newcomer.chain.length, 3);
  assert.equal(blockHash(newcomer.chain.lastBlock.header), tip(a));
});

test("вузол після перезапуску відновлює ланцюг із файлу", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pz1-node-"));
  try {
    const file = join(dir, "chain.json");
    const { nodes } = createNetwork(["a"], { a: file });
    const a = nodes["a"] as TestNode;
    await a.node.mine();
    await a.node.mine();

    const restarted = createNetwork(["a"], { a: file }).nodes["a"] as TestNode;
    assert.equal(restarted.node.chain.length, 3);
    assert.equal(tip(restarted), tip(a));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
