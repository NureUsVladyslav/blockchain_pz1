import { blockHash, verifyBlockStructure } from "../core/block.ts";
import { Blockchain } from "../core/blockchain.ts";
import { Mempool } from "../core/mempool.ts";
import { mineNextBlock } from "../core/miner.ts";
import { loadChain, saveChain } from "../core/storage.ts";
import { transactionId } from "../core/transaction.ts";
import type { Block } from "../core/block.ts";
import type { ChainOptions } from "../core/blockchain.ts";
import type { ChainView } from "../core/mempool.ts";
import type { CheckResult, Transaction } from "../core/transaction.ts";

type Failure = { ok: false; reason: string };
const fail = (reason: string): Failure => ({ ok: false, reason });

export interface Transport {
  sendTransaction(to: string, from: string, tx: unknown): Promise<void>;
  sendBlock(to: string, from: string, block: unknown): Promise<void>;
  fetchChain(to: string): Promise<unknown>;
}

export interface NodeOptions {
  url: string;
  minerAddress: string;
  transport: Transport;
  chainOptions?: ChainOptions;
  storagePath?: string;
  log?: (message: string) => void;
}

export type SyncResult =
  | {
      ok: true;
      adopted: boolean;
      orphanedBlocks: number;
      returnedTransactions: number;
    }
  | Failure;

export class Node {
  #url: string;
  #minerAddress: string;
  #transport: Transport;
  #chainOptions: ChainOptions;
  #storagePath: string | undefined;
  #log: (message: string) => void;

  #chain: Blockchain;
  #pool: Mempool;
  #peers = new Set<string>();
  #online = true;

  constructor(options: NodeOptions) {
    this.#url = options.url;
    this.#minerAddress = options.minerAddress;
    this.#transport = options.transport;
    this.#chainOptions = options.chainOptions ?? {};
    this.#storagePath = options.storagePath;
    this.#log = options.log ?? (() => {});

    this.#chain = this.#storagePath
      ? loadChain(this.#storagePath, this.#chainOptions)
      : new Blockchain(this.#chainOptions);

    // Мемпул питає про баланси "переходник", який завжди дивиться на актуальний ланцюг
    // (після переходу на іншу ланцюг об'єкт ланцюга змінюється, а мемпул лишається той самий).
    const view: ChainView = {
      getBalance: (address) => this.#chain.getBalance(address),
      getNextNonce: (address) => this.#chain.getNextNonce(address),
      hasTransaction: (id) => this.#chain.hasTransaction(id),
    };
    this.#pool = new Mempool(view);
  }

  get url(): string {
    return this.#url;
  }
  get chain(): Blockchain {
    return this.#chain;
  }
  get mempool(): Mempool {
    return this.#pool;
  }
  get peers(): string[] {
    return Array.from(this.#peers);
  }
  get online(): boolean {
    return this.#online;
  }
  get minerAddress(): string {
    return this.#minerAddress;
  }

  getStatus() {
    return {
      url: this.#url,
      online: this.#online,
      minerAddress: this.#minerAddress,
      height: this.#chain.length - 1,
      lastBlockHash: blockHash(this.#chain.lastBlock.header),
      nextDifficulty: this.#chain.getNextDifficulty(),
      totalWork: this.#chain.totalWork.toString(),
      mempoolSize: this.#pool.size,
      peers: this.peers,
    };
  }
  // Який nonce має бути в наступної транзакції адреси: підтверджені + що у мемпулі
  nextNonceFor(address: string): number {
    const pending = this.#pool
      .getAll()
      .filter((tx) => tx.from === address).length;
    return this.#chain.getNextNonce(address) + pending;
  }
  // Повна перевірка власного ланцюга з нуля за всіма правилами
  validateChain(): CheckResult {
    const result = Blockchain.fromBlocks(
      this.#chain.blocks,
      this.#chainOptions,
    );
    return result.ok ? { ok: true } : fail(result.reason);
  }
  addPeer(url: string): void {
    if (url !== this.#url) this.#peers.add(url);
  }

  // Відключити вузол від мережі (для демонстрації форку)
  setOnline(online: boolean): void {
    this.#online = online;
    this.#log(
      online ? "Вузол підключено до мережі" : "Вузол відключено від мережі",
    );
  }

  #persist(): void {
    if (this.#storagePath) saveChain(this.#chain, this.#storagePath);
  }

  async #broadcastTransaction(tx: unknown, exceptUrl?: string): Promise<void> {
    if (!this.#online) return;
    const targets = this.peers.filter((peer) => peer !== exceptUrl);
    await Promise.allSettled(
      targets.map((peer) =>
        this.#transport.sendTransaction(peer, this.#url, tx),
      ),
    );
  }

  async #broadcastBlock(block: Block, exceptUrl?: string): Promise<void> {
    if (!this.#online) return;
    const targets = this.peers.filter((peer) => peer !== exceptUrl);
    await Promise.allSettled(
      targets.map((peer) => this.#transport.sendBlock(peer, this.#url, block)),
    );
  }

  // Транзакція від користувача цього вузла: працює і без мережі, розсилається лише якщо вузол онлайн
  async submitTransaction(tx: unknown): Promise<CheckResult> {
    const result = this.#pool.add(tx);
    if (result.ok) {
      this.#log("Транзакцію прийнято в мемпул");
      await this.#broadcastTransaction(tx);
    }
    return result;
  }

  // Транзакція від сусіда по мережі. Пересилаємо далі лише якщо вона для нас нова.
  async receiveTransaction(tx: unknown, fromUrl: string): Promise<CheckResult> {
    if (!this.#online) return fail("Вузол відключений від мережі");
    const result = this.#pool.add(tx);
    if (result.ok) await this.#broadcastTransaction(tx, fromUrl);
    return result;
  }

  // Намайнити наступний блок із мемпулу, додати у свій ланцюг і розіслати сусідам
  async mine(): Promise<Block> {
    const block = mineNextBlock(this.#chain, this.#pool, this.#minerAddress);
    const result = this.#chain.addBlock(block);
    if (!result.ok)
      throw new Error(`Власний блок не пройшов перевірку: ${result.reason}`);
    this.#pool.revalidate();
    this.#persist();
    this.#log(`Намайнено блок №${block.header.index}`);
    await this.#broadcastBlock(block);
    return block;
  }

  // Блок від сусіда. Якщо він продовжує наш ланцюг, додаємо. Якщо ні (ми відстали або гілки розійшлися),
  // просимо в відправника весь його ланцюг і порівнюємо, в чий вкладено більше роботи.
  async receiveBlock(block: unknown, fromUrl: string): Promise<CheckResult> {
    if (!this.#online) return fail("Вузол відключений від мережі");

    const added = this.#chain.addBlock(block);
    if (added.ok) {
      this.#pool.revalidate();
      this.#persist();
      this.#log(
        `Прийнято блок №${(block as Block).header.index} від ${fromUrl}`,
      );
      await this.#broadcastBlock(block as Block, fromUrl);
      return { ok: true };
    }

    // Блок не підійшов. Якщо хоча б сама форма правильна, можливо, у відправника інша гілка
    if (!verifyBlockStructure(block).ok) return added;
    const sync = await this.syncWith(fromUrl);
    if (!sync.ok) return sync;
    return sync.adopted
      ? { ok: true }
      : fail(
          "Блок не продовжує наш ланцюг, а ланцюг відправника не має більше роботи",
        );
  }

  // Ланцюг для сусіда, який просить синхронізуватися (відключений вузол не відповідає)
  serveChain(): readonly Block[] {
    if (!this.#online) throw new Error("Вузол відключений від мережі");
    return this.#chain.blocks;
  }

  // Синхронізація з одним сусідом: беремо його ланцюг, повністю перевіряємо і, якщо в ньому
  // строго більше сумарної роботи, переходимо на нього.
  async syncWith(peerUrl: string): Promise<SyncResult> {
    if (!this.#online) return fail("Вузол відключений від мережі");

    let data: unknown;
    try {
      data = await this.#transport.fetchChain(peerUrl);
    } catch {
      return fail(`Не вдалося отримати ланцюг від ${peerUrl}`);
    }

    const loaded = Blockchain.fromBlocks(data, this.#chainOptions);
    if (!loaded.ok)
      return fail(`Ланцюг вузла ${peerUrl} недійсний: ${loaded.reason}`);

    if (loaded.chain.totalWork <= this.#chain.totalWork) {
      return {
        ok: true,
        adopted: false,
        orphanedBlocks: 0,
        returnedTransactions: 0,
      };
    }

    const summary = this.#replaceChain(loaded.chain);
    this.#log(
      `Перехід на ланцюг вузла ${peerUrl} з більшою роботою: відкинуто блоків ${summary.orphanedBlocks}, ` +
        `транзакцій повернуто в мемпул ${summary.returnedTransactions}`,
    );
    await this.#broadcastBlock(this.#chain.lastBlock, peerUrl);
    return { ok: true, adopted: true, ...summary };
  }

  // Синхронізація з усіма сусідами по черзі
  async syncAll(): Promise<Record<string, SyncResult>> {
    const results: Record<string, SyncResult> = {};
    for (const peer of this.peers) results[peer] = await this.syncWith(peer);
    return results;
  }

  // Заміна ланцюга на кращий. Транзакції блоків, що програли, повертаються в мемпул.
  #replaceChain(newChain: Blockchain): {
    orphanedBlocks: number;
    returnedTransactions: number;
  } {
    const ours = this.#chain.blocks;
    const theirs = newChain.blocks;

    // Спільна частина: блоки від початку, що збігаються за хешем
    let common = 0;
    while (
      common < ours.length &&
      common < theirs.length &&
      blockHash((ours[common] as Block).header) ===
        blockHash((theirs[common] as Block).header)
    ) {
      common++;
    }

    // Звичайні транзакції (без винагороди) із блоків, що програли, за порядком
    const orphaned = ours.slice(common);
    const orphanedTransactions = orphaned.flatMap(
      (block) => block.transactions.slice(1) as Transaction[],
    );
    const waiting = this.#pool.getAll();

    this.#chain = newChain;
    // Спершу повернуті транзакції (вони старіші, їхні nonce йдуть першими), потім ті, що вже чекали
    this.#pool.rebuild([...orphanedTransactions, ...waiting]);
    const returned = orphanedTransactions.filter((tx) =>
      this.#pool.has(transactionId(tx)),
    ).length;

    this.#persist();
    return { orphanedBlocks: orphaned.length, returnedTransactions: returned };
  }
}
