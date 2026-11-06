import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli/run.ts";
import { Node } from "../src/node/node.ts";
import { HttpTransport } from "../src/node/http-transport.ts";
import { createRequestHandler } from "../src/node/server.ts";
import { generateWallet } from "../src/core/wallet.ts";
import { saveWallet } from "../src/core/wallet-store.ts";
import type { ChainOptions } from "../src/core/blockchain.ts";
import type { Wallet } from "../src/core/wallet.ts";

const options: ChainOptions = {
  genesisDifficulty: 4,
  difficultyParams: {
    retargetInterval: 100,
    targetBlockTimeMs: 10_000,
    minDifficulty: 1,
  },
};

// Піднімає справжній вузол на вільному порту; його гаманець майнера це переданий гаманець
async function startNode(
  wallet: Wallet,
): Promise<{ url: string; server: Server; node: Node }> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const node = new Node({
    url,
    minerAddress: wallet.address,
    transport: new HttpTransport(),
    chainOptions: options,
  });
  server.on("request", createRequestHandler(node));
  return { url, server, node };
}

// Запускає команду і повертає код завершення та весь вивід
async function cli(args: string[]): Promise<{ code: number; text: string }> {
  const lines: string[] = [];
  const code = await runCli(args, (line) => lines.push(line));
  return { code, text: lines.join("\n") };
}

test("CLI: повний шлях користувача (гаманець, майнінг, переказ, баланс, перевірка ланцюга)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pz1-cli-"));
  const aliceFile = join(dir, "alice.json");
  const bob = generateWallet();
  const alice = generateWallet();
  saveWallet(alice, aliceFile);
  const { url, server } = await startNode(alice); // майнер вузла це Аліса
  try {
    const base = ["--node", url, "--wallet", aliceFile];

    // Гаманець: створення в новий файл, повторне створення без --force відхиляється
    const newFile = join(dir, "new.json");
    const created = await cli(["wallet", "create", "--wallet", newFile]);
    assert.equal(created.code, 0);
    assert.match(created.text, /Адреса: [0-9a-f]{64}/);
    assert.equal(
      (await cli(["wallet", "create", "--wallet", newFile])).code,
      1,
    );
    assert.equal(
      (await cli(["wallet", "create", "--wallet", newFile, "--force"])).code,
      0,
    );
    assert.match(
      (await cli(["wallet", "show", ...base])).text,
      new RegExp(alice.address),
    );

    // Майнінг: винагорода Аліси
    assert.match((await cli(["mine", ...base])).text, /Намайнено блок №1/);
    assert.match((await cli(["balance", ...base])).text, /Баланс .*: 50/);

    // Дві транзакції підряд: nonce береться автоматично (0, потім 1 з урахуванням черги)
    assert.equal(
      (await cli(["send", bob.address, "10", "--fee", "2", ...base])).code,
      0,
    );
    assert.match(
      (await cli(["send", bob.address, "10", "--fee", "2", ...base])).text,
      /nonce 1/,
    );
    assert.match((await cli(["mempool", ...base])).text, /транзакцій: 2/);

    // Транзакція понад баланс відхиляється з причиною
    const tooMuch = await cli(["send", bob.address, "1000", ...base]);
    assert.equal(tooMuch.code, 1);
    assert.match(tooMuch.text, /Недостатньо коштів/);

    // Майнимо блок із переказами і дивимось баланси
    assert.match((await cli(["mine", ...base])).text, /Намайнено блок №2/);
    assert.match(
      (await cli(["balance", bob.address, "--node", url])).text,
      /: 20/,
    );
    assert.match((await cli(["balance", ...base])).text, /: 80/); // 50 - 24 + (50 + 4 комісії)

    // Ланцюг і його перевірка
    const chain = await cli(["chain", "--node", url]);
    assert.equal(chain.text.split("\n").length, 4); // заголовок + генезис + 2 блоки
    assert.equal((await cli(["validate", "--node", url])).code, 0);
    assert.match((await cli(["status", "--node", url])).text, /"height": 2/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: мережеві команди (сусід, синхронізація, відключення)", async () => {
  const a = await startNode(generateWallet());
  const b = await startNode(generateWallet());
  try {
    assert.equal((await cli(["add-peer", b.url, "--node", a.url])).code, 0);
    assert.equal((await cli(["add-peer", a.url, "--node", b.url])).code, 0);
    assert.match(
      (await cli(["peers", "--node", a.url])).text,
      new RegExp(b.url),
    );

    await cli(["offline", "--node", b.url]);
    await cli(["mine", "--node", a.url]);
    assert.equal(b.node.chain.length, 1); // B відключений, блок не дійшов

    await cli(["online", "--node", b.url]);
    const sync = await cli(["sync", "--node", b.url]);
    assert.match(sync.text, /перейшли на їхній ланцюг/);
    assert.equal(b.node.chain.length, 2);
  } finally {
    for (const r of [a, b]) {
      r.server.closeAllConnections();
      await new Promise<void>((resolve) => r.server.close(() => resolve()));
    }
  }
});

test("CLI: помилки (невідома команда, погані аргументи, вузол недоступний)", async () => {
  assert.equal((await cli([])).code, 1); // без команди
  assert.equal((await cli(["help"])).code, 0);

  const unknown = await cli(["abracadabra"]);
  assert.equal(unknown.code, 1);
  assert.match(unknown.text, /Невідома команда/);

  assert.equal((await cli(["send", "abc", "5"])).code, 1); // погана адреса
  assert.equal((await cli(["--nonexistent"])).code, 1); // невідомий прапорець

  // Вузол не запущено
  const down = await cli(["status", "--node", "http://127.0.0.1:1"]);
  assert.equal(down.code, 1);
  assert.match(down.text, /Не вдалося підключитися/);
});
