import type { Transport } from "./node.ts";

const TIMEOUT_MS = 5000;

// Справжній транспорт: HTTP-запити до сусідів (вбудований fetch). У заголовку x-node-url
// вказуємо власну адресу, щоб сусід знав, від кого прийшло.
export class HttpTransport implements Transport {
  async #post(
    to: string,
    path: string,
    from: string,
    body: unknown,
  ): Promise<void> {
    await fetch(`${to}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-node-url": from },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  async sendTransaction(to: string, from: string, tx: unknown): Promise<void> {
    await this.#post(to, "/transactions", from, tx);
  }

  async sendBlock(to: string, from: string, block: unknown): Promise<void> {
    await this.#post(to, "/blocks", from, block);
  }

  async fetchChain(to: string): Promise<unknown> {
    const response = await fetch(`${to}/chain`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok)
      throw new Error(`Вузол ${to} відповів кодом ${response.status}`);
    return response.json();
  }
}
