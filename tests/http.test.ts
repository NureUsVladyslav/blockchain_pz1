import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Node } from "../src/node/node.ts";
import { HttpTransport } from "../src/node/http-transport.ts";
import { createRequestHandler } from "../src/node/server.ts";
import { generateWallet } from "../src/core/wallet.ts";
import { createTransaction, transactionId } from "../src/core/transaction.ts";
import type { ChainOptions } from "../src/core/blockchain.ts";
import type { Transaction } from "../src/core/transaction.ts";
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

interface Running {
  node: Node;
  wallet: Wallet;
  url: string;
  server: Server;
}

// Піднімає справжній HTTP-сервер вузла на вільному порту (порт 0 означає "обери будь-який вільний")
async function startNode(): Promise<Running> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const wallet = generateWallet();
  const node = new Node({
    url,
    minerAddress: wallet.address,
    transport: new HttpTransport(),
    chainOptions: options,
  });
  server.on("request", createRequestHandler(node));
  return { node, wallet, url, server };
}

async function stopAll(running: Running[]): Promise<void> {
  for (const r of running) {
    r.server.closeAllConnections();
    await new Promise<void>((resolve) => r.server.close(() => resolve()));
  }
}

async function call(
  url: string,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

async function status(url: string) {
  return (await call(url, "GET", "/status")).body as {
    height: number;
    lastBlockHash: string;
    mempoolSize: number;
  };
}

test("три вузли на справжніх портах: розсилка, форк, перехід на ланцюг з більшою роботою", async () => {
  const [a, b, c] = [
    await startNode(),
    await startNode(),
    await startNode(),
  ] as [Running, Running, Running];
  try {
    // З'єднуємо вузли через HTTP-команду додавання сусіда
    for (const x of [a, b, c]) {
      for (const y of [a, b, c]) {
        if (x !== y)
          assert.equal(
            (await call(x.url, "POST", "/peers", { url: y.url })).status,
            200,
          );
      }
    }

    // A майнить блок, його отримують усі
    assert.equal((await call(a.url, "POST", "/mine")).status, 200);
    assert.equal((await status(b.url)).height, 1);
    assert.equal((await status(c.url)).height, 1);

    // Відключаємо C: його ланцюг і запити до нього недоступні
    await call(c.url, "POST", "/network/offline");
    assert.equal((await call(c.url, "GET", "/chain")).status, 503);
    assert.equal(
      (await call(c.url, "POST", "/blocks", {}, { "x-node-url": a.url }))
        .status,
      503,
    );

    // Користувач надсилає транзакцію на A, вона доходить до B (з'являється в його мемпулі), а до C ні
    const tx: Transaction = createTransaction(
      a.wallet,
      generateWallet().address,
      10,
      2,
      0,
    );
    assert.equal((await call(a.url, "POST", "/transactions", tx)).status, 200);
    assert.equal((await status(b.url)).mempoolSize, 1);
    assert.equal((await status(c.url)).mempoolSize, 0);

    // A і B живуть без C, у C за цей час два блоки (більше роботи)
    await call(a.url, "POST", "/mine");
    await call(c.url, "POST", "/mine");
    await call(c.url, "POST", "/mine");
    assert.equal((await status(a.url)).height, 2);
    assert.equal((await status(c.url)).height, 3);

    // C повертається, A синхронізується і переходить на ланцюг C
    await call(c.url, "POST", "/network/online");
    await call(a.url, "POST", "/sync");
    const tips = [
      await status(a.url),
      await status(b.url),
      await status(c.url),
    ].map((s) => s.lastBlockHash);
    assert.equal(new Set(tips).size, 1); // всі на одному ланцюгу
    assert.equal((await status(a.url)).height, 3);

    // Транзакція з відкинутого блоку повернулась у мемпул
    assert.equal(a.node.mempool.has(transactionId(tx)), true);
    assert.deepEqual((await call(a.url, "GET", "/validate")).body, {
      ok: true,
    });
  } finally {
    await stopAll([a, b, c]);
  }
});

test("HTTP: некоректні запити відхиляються з правильними кодами", async () => {
  const a = await startNode();
  try {
    assert.equal((await call(a.url, "GET", "/nope")).status, 404);
    assert.equal(
      (await call(a.url, "POST", "/transactions", { bad: 1 })).status,
      400,
    );
    assert.equal((await call(a.url, "POST", "/blocks", {})).status, 400); // немає заголовка x-node-url
    assert.equal(
      (await call(a.url, "POST", "/peers", { url: "не адреса" })).status,
      400,
    );
    assert.equal((await call(a.url, "GET", "/balance/abc")).status, 400);

    const raw = await fetch(`${a.url}/transactions`, {
      method: "POST",
      body: "{ не json",
    });
    assert.equal(raw.status, 400);

    const balance = await call(a.url, "GET", `/balance/${a.wallet.address}`);
    assert.deepEqual(balance.body, { address: a.wallet.address, balance: 0 });
  } finally {
    await stopAll([a]);
  }
});
