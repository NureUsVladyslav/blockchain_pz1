import { readdirSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { runCli } from "../cli/run.ts";
import { blockHash } from "../core/block.ts";
import { loadWallet } from "../core/wallet-store.ts";
import { isHex } from "../utils/hex.ts";
import { isObject } from "../utils/object.ts";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Block } from "../core/block.ts";

export interface UiOptions {
  nodes: string[]; // адреси вузлів, до яких може звертатися інтерфейс
  walletsDir: string; // папка з файлами гаманців
  html: string; // готова HTML-сторінка
  port: number; // потрібен для перевірки заголовка Host
}

const NODE_TIMEOUT_MS = 3_000;
const MAX_BODY_BYTES = 64 * 1024;
const NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!String(req.headers["content-type"]).startsWith("application/json")) {
    throw new HttpError(415, "Очікується application/json");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const part = chunk as Buffer;
    size += part.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Тіло запиту завелике");
    chunks.push(part);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "Некоректний JSON");
  }
}

async function nodeGet(
  base: string,
  path: string,
): Promise<{ status: number; data: unknown }> {
  const response = await fetch(`${base}${path}`, {
    signal: AbortSignal.timeout(NODE_TIMEOUT_MS),
  });
  return { status: response.status, data: await response.json() };
}

interface WalletInfo {
  name: string;
  address: string;
}

// Читає папку з гаманцями. Приватні ключі назовні не віддаються: беремо тільки адресу
function listWallets(dir: string): WalletInfo[] {
  let files: string[];
  try {
    files = readdirSync(dir).sort();
  } catch {
    return [];
  }
  const result: WalletInfo[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const name = file.slice(0, -".json".length);
    if (!NAME_RE.test(name)) continue;
    try {
      result.push({ name, address: loadWallet(join(dir, file)).address });
    } catch {}
  }
  return result;
}

// Транзакція для показу: беремо тільки поля, які є
function txView(tx: unknown): Record<string, unknown> {
  if (!isObject(tx)) return {};
  const view: Record<string, unknown> = {};
  for (const key of ["from", "to", "amount", "fee", "nonce"]) {
    if (key in tx) view[key] = tx[key];
  }
  return view;
}

export function createUiServer(options: UiOptions): Server {
  const { nodes, walletsDir, html, port } = options;
  const allowedHosts = [`localhost:${port}`, `127.0.0.1:${port}`];

  function nodeAt(value: unknown): string {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      throw new HttpError(400, "Невірний номер вузла");
    }
    const url = nodes[value];
    if (url === undefined) throw new HttpError(400, "Такого вузла немає");
    return url;
  }

  function walletPath(name: unknown): string {
    if (typeof name !== "string" || !NAME_RE.test(name)) {
      throw new HttpError(
        400,
        "Назва гаманця: латинські літери, цифри, - і _ (до 32 символів)",
      );
    }
    return join(walletsDir, `${name}.json`);
  }

  // Короткий огляд усіх вузлів (для карток угорі)
  async function overview(): Promise<unknown> {
    return Promise.all(
      nodes.map(async (url) => {
        try {
          const response = await nodeGet(url, "/status");
          if (response.status !== 200) throw new Error("статус не 200");
          return { url, ok: true, status: response.data };
        } catch {
          return { url, ok: false };
        }
      }),
    );
  }

  // Повний стан одного вузла: статус, ланцюг, мемпул, баланси гаманців
  async function nodeState(base: string): Promise<unknown> {
    const wallets = listWallets(walletsDir);
    try {
      const [status, chain, mempool] = await Promise.all([
        nodeGet(base, "/status"),
        nodeGet(base, "/chain/local"),
        nodeGet(base, "/mempool"),
      ]);
      if (!Array.isArray(chain.data) || !Array.isArray(mempool.data)) {
        throw new Error("вузол повернув несподівану відповідь");
      }
      const balances = await Promise.all(
        wallets.map(async (wallet) => {
          const response = await nodeGet(base, `/balance/${wallet.address}`);
          const balance =
            isObject(response.data) && typeof response.data.balance === "number"
              ? response.data.balance
              : null;
          return { ...wallet, balance };
        }),
      );
      const blocks = (chain.data as Block[]).map((block) => ({
        index: block.header.index,
        hash: blockHash(block.header),
        previousHash: block.header.previousHash,
        difficulty: block.header.difficulty,
        nonce: block.header.nonce,
        timestamp: block.header.timestamp,
        transactions: block.transactions.map(txView),
      }));
      return {
        ok: true,
        url: base,
        status: status.data,
        wallets: balances,
        blocks,
        mempool: (mempool.data as unknown[]).map(txView),
      };
    } catch (error) {
      return {
        ok: false,
        url: base,
        wallets,
        error: `Вузол ${base} недоступний: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // Усі дії виконує та сама runCli, що й консольна програма: поведінка однакова
  async function action(body: unknown): Promise<unknown> {
    if (!isObject(body)) throw new HttpError(400, "Очікується об'єкт");
    const node = nodeAt(body.node);
    let args: string[];
    switch (body.command) {
      case "wallet-create":
        args = ["wallet", "create", "--wallet", walletPath(body.wallet)];
        break;
      case "send": {
        const { to, amount, fee } = body;
        if (typeof to !== "string" || !isHex(to, 32)) {
          throw new HttpError(
            400,
            "Адреса отримувача має бути рядком із 64 hex-символів",
          );
        }
        if (
          typeof amount !== "string" ||
          typeof fee !== "string" ||
          !/^\d+$/.test(amount) ||
          !/^\d+$/.test(fee)
        ) {
          throw new HttpError(
            400,
            "Сума і комісія мають бути цілими невід'ємними числами",
          );
        }
        args = [
          "send",
          to,
          amount,
          "--fee",
          fee,
          "--wallet",
          walletPath(body.wallet),
        ];
        break;
      }
      case "mine":
      case "sync":
      case "offline":
      case "online":
      case "validate":
        args = [body.command];
        break;
      case "add-peer": {
        const { url } = body;
        if (typeof url !== "string" || !/^https?:\/\/\S+$/.test(url)) {
          throw new HttpError(400, "Адреса сусіда: http://хост:порт");
        }
        args = ["add-peer", url];
        break;
      }
      case "verify-tx": {
        const { id } = body;
        if (typeof id !== "string" || !isHex(id, 32)) {
          throw new HttpError(
            400,
            "Ідентифікатор транзакції має бути рядком із 64 hex-символів",
          );
        }
        args = ["verify-tx", id];
        break;
      }
      default:
        throw new HttpError(400, "Невідома команда");
    }
    const lines: string[] = [];
    const code = await runCli([...args, "--node", node], (line) => {
      lines.push(...line.split("\n"));
    });
    return { code, lines };
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    // Захист від DNS rebinding: приймаємо тільки запити до localhost
    if (!allowedHosts.includes(String(req.headers.host))) {
      throw new HttpError(403, "Недопустимий Host");
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    const route = `${req.method} ${url.pathname}`;

    if (route === "GET /") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    } else if (route === "GET /api/config") {
      sendJson(res, 200, { nodes });
    } else if (route === "GET /api/nodes") {
      sendJson(res, 200, await overview());
    } else if (route === "GET /api/state") {
      sendJson(
        res,
        200,
        await nodeState(nodeAt(Number(url.searchParams.get("node")))),
      );
    } else if (route === "POST /api/action") {
      sendJson(res, 200, await action(await readJson(req)));
    } else {
      throw new HttpError(404, "Не знайдено");
    }
  }

  return createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (error instanceof HttpError) {
        sendJson(res, error.status, { reason: error.message });
      } else {
        sendJson(res, 500, {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    });
  });
}
