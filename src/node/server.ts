import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { isHex } from "../utils/hex.ts";
import { isObject } from "../utils/object.ts";
import type { CheckResult } from "../core/transaction.ts";
import type { Node } from "./node.ts";
import { createTransactionProof } from "../core/proof.ts";

const MAX_BODY_BYTES = 5_000_000;
const OFFLINE_MESSAGE = "Вузол відключений від мережі";

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendResult(res: ServerResponse, result: CheckResult): void {
  if (result.ok) {
    sendJson(res, 200, { ok: true });
  } else sendJson(res, 400, { ok: false, reason: result.reason });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Тіло запиту завелике");
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Тіло запиту не є коректним JSON");
  }
}

function senderUrl(req: IncomingMessage): string | undefined {
  const header = req.headers["x-node-url"];
  return typeof header === "string" && header !== "" ? header : undefined;
}

async function handle(
  node: Node,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const route = `${req.method} ${url.pathname}`;
  const from = senderUrl(req);

  switch (route) {
    case "POST /transactions": {
      const tx = await readJson(req);
      if (from === undefined)
        return sendResult(res, await node.submitTransaction(tx));
      if (!node.online) throw new HttpError(503, OFFLINE_MESSAGE);
      return sendResult(res, await node.receiveTransaction(tx, from));
    }
    case "POST /blocks": {
      const block = await readJson(req);
      if (from === undefined)
        throw new HttpError(400, "Потрібен заголовок x-node-url");
      if (!node.online) throw new HttpError(503, OFFLINE_MESSAGE);
      return sendResult(res, await node.receiveBlock(block, from));
    }
    case "GET /chain": {
      if (!node.online) throw new HttpError(503, OFFLINE_MESSAGE);
      return sendJson(res, 200, node.serveChain());
    }

    case "GET /chain/local":
      return sendJson(res, 200, node.chain.blocks);
    case "GET /headers":
      return sendJson(
        res,
        200,
        node.chain.blocks.map((block) => block.header),
      );
    case "GET /status":
      return sendJson(res, 200, node.getStatus());
    case "GET /mempool":
      return sendJson(res, 200, node.mempool.getAll());
    case "GET /validate":
      return sendResult(res, node.validateChain());
    case "GET /peers":
      return sendJson(res, 200, node.peers);
    case "POST /peers": {
      const body = await readJson(req);
      if (
        !isObject(body) ||
        typeof body.url !== "string" ||
        !/^https?:\/\//.test(body.url)
      ) {
        throw new HttpError(400, 'Очікується { "url": "http://..." }');
      }
      node.addPeer(body.url);
      return sendJson(res, 200, { ok: true, peers: node.peers });
    }
    case "POST /mine": {
      const block = await node.mine();
      return sendJson(res, 200, {
        ok: true,
        index: block.header.index,
        nonce: block.header.nonce,
        difficulty: block.header.difficulty,
        transactions: block.transactions.length,
      });
    }
    case "POST /sync":
      return sendJson(res, 200, await node.syncAll());
    case "POST /network/offline":
      node.setOnline(false);
      return sendJson(res, 200, { ok: true, online: false });
    case "POST /network/online":
      node.setOnline(true);
      return sendJson(res, 200, { ok: true, online: true });
  }

  if (req.method === "GET" && url.pathname.startsWith("/balance/")) {
    const address = url.pathname.slice("/balance/".length);
    if (!isHex(address, 32))
      throw new HttpError(400, "Адреса має бути рядком із 64 hex-символів");
    return sendJson(res, 200, {
      address,
      balance: node.chain.getBalance(address),
    });
  }
  if (req.method === "GET" && url.pathname.startsWith("/proof/")) {
    const txId = url.pathname.slice("/proof/".length);
    if (!isHex(txId, 32))
      throw new HttpError(
        400,
        "Ідентифікатор транзакції має бути рядком із 64 hex-символів",
      );
    const proof = createTransactionProof(node.chain, txId);
    if (proof === null)
      throw new HttpError(404, "Транзакцію не знайдено в ланцюгу");
    return sendJson(res, 200, proof);
  }
  if (req.method === "GET" && url.pathname.startsWith("/nonce/")) {
    const address = url.pathname.slice("/nonce/".length);
    if (!isHex(address, 32))
      throw new HttpError(400, "Адреса має бути рядком із 64 hex-символів");
    return sendJson(res, 200, { address, nonce: node.nextNonceFor(address) });
  }
  throw new HttpError(404, `Невідомий маршрут: ${route}`);
}

// Обробник запитів для вузла
export function createRequestHandler(
  node: Node,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    handle(node, req, res).catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500;
      const reason =
        error instanceof Error ? error.message : "Внутрішня помилка";
      sendJson(res, status, { ok: false, reason });
    });
  };
}

export function createNodeServer(node: Node): Server {
  return createServer(createRequestHandler(node));
}
