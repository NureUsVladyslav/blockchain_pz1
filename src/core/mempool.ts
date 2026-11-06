import { transactionId, verifyTransaction } from "./transaction.ts";
import type { CheckResult, Transaction } from "./transaction.ts";

const fail = (reason: string): CheckResult => ({ ok: false, reason });

// Те, що мемпулу потрібно знати про ланцюг блоків.
export interface ChainView {
  getBalance(address: string): number;
  getNextNonce(address: string): number;
  hasTransaction(id: string): boolean;
}

// Мемпул: черга перевірених транзакцій, які ще не потрапили в блок. У кожного вузла своя.
export class Mempool {
  #pool = new Map<string, Transaction>();
  #chain: ChainView;

  constructor(chain: ChainView) {
    this.#chain = chain;
  }

  get size(): number {
    return this.#pool.size;
  }

  has(id: string): boolean {
    return this.#pool.has(id);
  }

  getAll(): Transaction[] {
    return Array.from(this.#pool.values());
  }

  remove(ids: string[]): void {
    for (const id of ids) this.#pool.delete(id);
  }
  // Перевіряє всю чергу заново за поточним станом ланцюга: те, що вже потрапило в блок
  // або стало недійсним (наприклад, конфліктує з новим блоком), з черги зникає.
  // Викликаємо після того, як ланцюг отримав новий блок.
  revalidate(): void {
    const old = this.getAll();
    this.#pool.clear();
    for (const tx of old) this.add(tx);
  }
  // Очищає чергу і заново додає транзакції по порядку через звичайні перевірки.
  // Повертає, скільки з них прийнято. Використовується, коли ланцюг змінився цілком.
  rebuild(transactions: unknown[]): number {
    this.#pool.clear();
    let accepted = 0;
    for (const tx of transactions) {
      if (this.add(tx).ok) accepted++;
    }
    return accepted;
  }
  // Транзакції цього відправника, що вже чекають у черзі
  #pendingOf(address: string): Transaction[] {
    return this.getAll().filter((tx) => tx.from === address);
  }

  // Перевіряє транзакцію, якщо все гаразд, кладе в чергу.
  add(value: unknown): CheckResult {
    // 1. Підпис (разом із форматом і відповідністю ключа адресі)
    const verified = verifyTransaction(value);
    if (!verified.ok) return verified;
    const tx = value as Transaction;

    const pending = this.#pendingOf(tx.from);

    // 2. Nonce: підтверджені транзакції адреси + ті, що чекають у черзі
    const expectedNonce = this.#chain.getNextNonce(tx.from) + pending.length;
    if (tx.nonce !== expectedNonce) {
      return fail(
        `Неправильний nonce: очікується ${expectedNonce}, отримано ${tx.nonce}`,
      );
    }

    // 3. Баланс з урахуванням власних транзакцій відправника, що вже чекають у черзі
    const reserved = pending.reduce((sum, p) => sum + p.amount + p.fee, 0);
    const available = this.#chain.getBalance(tx.from) - reserved;
    const needed = tx.amount + tx.fee;
    if (available < needed) {
      return fail(
        `Недостатньо коштів: доступно ${available}, потрібно ${needed}`,
      );
    }

    // 4. Дублікат: у черзі або в ланцюгу
    const id = transactionId(tx);
    if (this.#pool.has(id) || this.#chain.hasTransaction(id)) {
      return fail("Така транзакція вже є в черзі або в ланцюгу");
    }

    this.#pool.set(id, tx);
    return { ok: true };
  }
}
