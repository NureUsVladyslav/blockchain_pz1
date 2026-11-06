import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { blockHash } from "../core/block.ts";
import { createTransaction, transactionId } from "../core/transaction.ts";
import { LightClient } from "../light/light-client.ts";
import { chainOptionsFromEnv } from "../node/settings.ts";
import { generateWallet } from "../core/wallet.ts";
import { loadWallet, saveWallet } from "../core/wallet-store.ts";
import { isHex } from "../utils/hex.ts";
import { isObject } from "../utils/object.ts";
import type { Block } from "../core/block.ts";
import type { Transaction } from "../core/transaction.ts";
import type { ChainOptions } from "../core/blockchain.ts";
export type Output = (line: string) => void;

const DEFAULT_NODE = "http://localhost:3001";
const DEFAULT_WALLET = "wallets/default.json";
const REQUEST_TIMEOUT_MS = 300_000;

const HELP = `Використання: node src/cli.ts <команда> [аргументи] [прапорці]

Гаманець:
  wallet create [--force]            створити гаманець і зберегти у файл
  wallet show                        показати адресу гаманця (приватний ключ не показується)

Транзакції та блоки:
  send <адреса> <сума> [--fee N]     надіслати транзакцію (комісія за замовчуванням 1)
  mine                               намайнити блок
  chain [--full]                     показати ланцюг (--full: повний JSON)
  balance [адреса]                   баланс адреси (без аргументу: адреса свого гаманця)
  mempool                            транзакції, що чекають у черзі
  validate                           повна перевірка ланцюга вузла
  verify-tx <id транзакції>          "легкий клієнт": перевірити за заголовками і доказом Меркла, що транзакція є в блоці
Мережа:
  status                             стан вузла
  peers                              список сусідів
  add-peer <url>                     додати сусіда
  sync                               синхронізуватися з мережею
  offline | online                   відключити вузол від мережі / підключити назад (для демонстрації форку)

Прапорці:
  --node <url>      адреса вузла (за замовчуванням ${DEFAULT_NODE} або змінна NODE_URL)
  --wallet <файл>   файл гаманця (за замовчуванням ${DEFAULT_WALLET})`;

interface ApiResponse {
  status: number;
  data: unknown;
}

async function api(
  nodeUrl: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResponse> {
  const response = await fetch(`${nodeUrl}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return { status: response.status, data: await response.json() };
}

// Причина відмови з відповіді вузла (поле reason) або весь текст відповіді
function reasonOf(data: unknown): string {
  return isObject(data) && typeof data.reason === "string"
    ? data.reason
    : JSON.stringify(data);
}

const shortHash = (hash: string): string => `${hash.slice(0, 12)}…`;
const formatTime = (ms: number): string =>
  new Date(ms).toISOString().replace("T", " ").slice(0, 19);

function printChain(blocks: Block[], out: Output): void {
  out(
    [
      "№".padEnd(4),
      "хеш".padEnd(14),
      "попередній".padEnd(14),
      "складн.".padEnd(8),
      "nonce".padEnd(10),
      "транз.".padEnd(7),
      "час",
    ].join(" "),
  );
  for (const block of blocks) {
    const h = block.header;
    out(
      [
        String(h.index).padEnd(4),
        shortHash(blockHash(h)).padEnd(14),
        shortHash(h.previousHash).padEnd(14),
        String(h.difficulty).padEnd(8),
        String(h.nonce).padEnd(10),
        String(block.transactions.length).padEnd(7),
        formatTime(h.timestamp),
      ].join(" "),
    );
  }
}

// Виконує команду. Повертає код завершення: 0 успіх, 1 помилка. Весь вивід іде через out.
export async function runCli(
  args: string[],
  out: Output,
  chainOptions: ChainOptions = chainOptionsFromEnv(),
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        node: { type: "string" },
        wallet: { type: "string" },
        fee: { type: "string" },
        force: { type: "boolean" },
        full: { type: "boolean" },
      },
    });
  } catch (error) {
    out(
      `Помилка в аргументах: ${error instanceof Error ? error.message : String(error)}`,
    );
    out(HELP);
    return 1;
  }

  const { values, positionals } = parsed;
  const [command, ...rest] = positionals;
  const nodeUrl = values.node ?? process.env.NODE_URL ?? DEFAULT_NODE;
  const walletPath = values.wallet ?? DEFAULT_WALLET;

  try {
    switch (command) {
      case "wallet": {
        const sub = rest[0];
        if (sub === "create") {
          if (existsSync(walletPath) && !values.force) {
            out(
              `Файл ${walletPath} уже існує. Щоб перезаписати, додайте --force (старий ключ буде втрачено).`,
            );
            return 1;
          }
          const wallet = generateWallet();
          saveWallet(wallet, walletPath);
          out(`Гаманець створено: ${walletPath}`);
          out(`Адреса: ${wallet.address}`);
          out(
            "Приватний ключ збережено у файлі. Нікому його не показуйте і не додавайте у репозиторій.",
          );
          return 0;
        }
        if (sub === "show") {
          out(`Адреса: ${loadWallet(walletPath).address}`);
          return 0;
        }
        out("Використання: wallet create | wallet show");
        return 1;
      }

      case "send": {
        const [to, amountText] = rest;
        const feeText = values.fee ?? "1";
        if (to === undefined || amountText === undefined) {
          out("Використання: send <адреса> <сума> [--fee N]");
          return 1;
        }
        if (!isHex(to, 32)) {
          out("Адреса отримувача має бути рядком із 64 hex-символів");
          return 1;
        }
        if (!/^\d+$/.test(amountText) || !/^\d+$/.test(feeText)) {
          out("Сума і комісія мають бути цілими невід'ємними числами");
          return 1;
        }
        const wallet = loadWallet(walletPath);
        const nonceResponse = await api(
          nodeUrl,
          "GET",
          `/nonce/${wallet.address}`,
        );
        if (
          nonceResponse.status !== 200 ||
          !isObject(nonceResponse.data) ||
          typeof nonceResponse.data.nonce !== "number"
        ) {
          out(`Не вдалося дізнатися nonce: ${reasonOf(nonceResponse.data)}`);
          return 1;
        }
        const nonce = nonceResponse.data.nonce;
        const tx: Transaction = createTransaction(
          wallet,
          to,
          Number(amountText),
          Number(feeText),
          nonce,
        );
        const response = await api(nodeUrl, "POST", "/transactions", tx);
        if (response.status !== 200) {
          out(`Транзакцію відхилено: ${reasonOf(response.data)}`);
          return 1;
        }
        out(
          `Транзакцію прийнято в мемпул вузла (nonce ${nonce}, сума ${amountText}, комісія ${feeText})`,
        );
        out(`id транзакції: ${transactionId(tx)}`);
        return 0;
      }

      case "mine": {
        const response = await api(nodeUrl, "POST", "/mine");
        if (response.status !== 200 || !isObject(response.data)) {
          out(`Не вдалося намайнити блок: ${reasonOf(response.data)}`);
          return 1;
        }
        const d = response.data;
        out(
          `Намайнено блок №${String(d.index)} (складність ${String(d.difficulty)}, nonce ${String(d.nonce)}, транзакцій ${String(d.transactions)})`,
        );
        return 0;
      }

      case "chain": {
        const response = await api(nodeUrl, "GET", "/chain/local");
        if (response.status !== 200 || !Array.isArray(response.data)) {
          out(`Помилка: ${reasonOf(response.data)}`);
          return 1;
        }
        if (values.full) out(JSON.stringify(response.data, null, 2));
        else printChain(response.data as Block[], out);
        return 0;
      }

      case "balance": {
        const address = rest[0] ?? loadWallet(walletPath).address;
        if (!isHex(address, 32)) {
          out("Адреса має бути рядком із 64 hex-символів");
          return 1;
        }
        const response = await api(nodeUrl, "GET", `/balance/${address}`);
        if (response.status !== 200 || !isObject(response.data)) {
          out(`Помилка: ${reasonOf(response.data)}`);
          return 1;
        }
        out(
          `Баланс ${address.slice(0, 12)}…: ${String(response.data.balance)}`,
        );
        return 0;
      }

      case "mempool": {
        const response = await api(nodeUrl, "GET", "/mempool");
        if (response.status !== 200 || !Array.isArray(response.data)) {
          out(`Помилка: ${reasonOf(response.data)}`);
          return 1;
        }
        const txs = response.data as Transaction[];
        out(`У мемпулі транзакцій: ${txs.length}`);
        for (const tx of txs) {
          out(
            `  ${tx.from.slice(0, 12)}… -> ${tx.to.slice(0, 12)}…  сума ${tx.amount}, комісія ${tx.fee}, nonce ${tx.nonce}`,
          );
        }
        return 0;
      }

      case "validate": {
        const response = await api(nodeUrl, "GET", "/validate");
        if (response.status === 200) {
          out("Ланцюг коректний: усі блоки пройшли перевірку");
          return 0;
        }
        out(`Ланцюг НЕКОРЕКТНИЙ: ${reasonOf(response.data)}`);
        return 1;
      }
      case "verify-tx": {
        const txId = rest[0];
        if (txId === undefined || !isHex(txId, 32)) {
          out("Використання: verify-tx <id транзакції (64 hex-символи)>");
          return 1;
        }
        const headersResponse = await api(nodeUrl, "GET", "/headers");
        const light = new LightClient(chainOptions);
        const loaded = light.loadHeaders(headersResponse.data);
        if (!loaded.ok) {
          out(`Заголовки вузла не пройшли перевірку: ${loaded.reason}`);
          out(
            "Якщо мережу запущено з нестандартною складністю, задайте ті самі змінні оточення (GENESIS_DIFFICULTY тощо) і для цієї команди.",
          );
          return 1;
        }
        out(
          `Легкий клієнт: заголовків ${light.headers.length}, усі пройшли перевірку (зв'язок, складність, Proof of Work)`,
        );

        const proofResponse = await api(nodeUrl, "GET", `/proof/${txId}`);
        if (proofResponse.status !== 200) {
          out(`Вузол не дав доказу: ${reasonOf(proofResponse.data)}`);
          return 1;
        }
        const checked = light.verifyInclusion(txId, proofResponse.data);
        if (!checked.ok) {
          out(`Доказ НЕ пройшов перевірку: ${checked.reason}`);
          return 1;
        }
        const data = proofResponse.data as {
          blockIndex: number;
          proof: unknown[];
        };
        out(
          `Транзакція входить у блок №${data.blockIndex}: корінь Меркла збігається. Доказ містить хешів: ${data.proof.length}.`,
        );
        return 0;
      }
      case "status": {
        const response = await api(nodeUrl, "GET", "/status");
        out(JSON.stringify(response.data, null, 2));
        return response.status === 200 ? 0 : 1;
      }

      case "peers": {
        const response = await api(nodeUrl, "GET", "/peers");
        const peers = Array.isArray(response.data)
          ? (response.data as string[])
          : [];
        out(peers.length > 0 ? peers.join("\n") : "Сусідів немає");
        return response.status === 200 ? 0 : 1;
      }

      case "add-peer": {
        const url = rest[0];
        if (url === undefined) {
          out("Використання: add-peer <url>");
          return 1;
        }
        const response = await api(nodeUrl, "POST", "/peers", { url });
        if (response.status !== 200) {
          out(`Не вдалося додати сусіда: ${reasonOf(response.data)}`);
          return 1;
        }
        out(`Сусіда додано: ${url}`);
        return 0;
      }

      case "sync": {
        const response = await api(nodeUrl, "POST", "/sync");
        if (response.status !== 200 || !isObject(response.data)) {
          out(`Помилка: ${reasonOf(response.data)}`);
          return 1;
        }
        const entries = Object.entries(response.data);
        if (entries.length === 0)
          out("Сусідів немає, синхронізуватися не з ким");
        for (const [peer, result] of entries) {
          if (!isObject(result)) continue;
          if (result.ok !== true) out(`${peer}: ${String(result.reason)}`);
          else if (result.adopted === true) {
            out(
              `${peer}: перейшли на їхній ланцюг (відкинуто блоків ${String(result.orphanedBlocks)}, транзакцій повернуто в мемпул ${String(result.returnedTransactions)})`,
            );
          } else out(`${peer}: змін немає`);
        }
        return 0;
      }

      case "offline":
      case "online": {
        const response = await api(nodeUrl, "POST", `/network/${command}`);
        out(
          response.status === 200
            ? command === "offline"
              ? "Вузол відключено від мережі"
              : "Вузол підключено до мережі"
            : `Помилка: ${reasonOf(response.data)}`,
        );
        return response.status === 200 ? 0 : 1;
      }

      case undefined:
      case "help":
        out(HELP);
        return command === undefined ? 1 : 0;

      default:
        out(`Невідома команда: ${command}`);
        out(HELP);
        return 1;
    }
  } catch (error) {
    if (error instanceof TypeError && String(error.message).includes("fetch")) {
      out(
        `Не вдалося підключитися до вузла ${nodeUrl}. Чи запущений вузол (npm run network)?`,
      );
    } else {
      out(`Помилка: ${error instanceof Error ? error.message : String(error)}`);
    }
    return 1;
  }
}
