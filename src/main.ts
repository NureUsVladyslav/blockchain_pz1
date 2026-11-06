import { join } from "node:path";
import { loadOrCreateWallet } from "./core/wallet-store.ts";
import { HttpTransport } from "./node/http-transport.ts";
import { Node } from "./node/node.ts";
import { createNodeServer } from "./node/server.ts";
import { chainOptionsFromEnv, numberEnv } from "./node/settings.ts";

const port = numberEnv("PORT", 3000);
const host = process.env.HOST ?? "127.0.0.1"; // у Docker вказуємо 0.0.0.0
const url = process.env.NODE_URL ?? `http://localhost:${port}`; // адреса, за якою цей вузол бачать сусіди
const peers = (process.env.PEERS ?? "")
  .split(",")
  .map((peer) => peer.trim())
  .filter((peer) => peer !== "");
const dataDir = process.env.DATA_DIR ?? join("data", String(port));

const log = (message: string): void => {
  console.log(
    `[${new Date().toISOString().slice(11, 19)}] [${port}] ${message}`,
  );
};

const wallet = loadOrCreateWallet(
  process.env.WALLET_FILE ?? join(dataDir, "wallet.json"),
); // гаманець майнера цього вузла
const node = new Node({
  url,
  minerAddress: wallet.address, // винагороди за блоки цього вузла йдуть на адресу його гаманця
  transport: new HttpTransport(),
  chainOptions: chainOptionsFromEnv(),
  storagePath: join(dataDir, "chain.json"),
  log,
});
for (const peer of peers) node.addPeer(peer);

const server = createNodeServer(node);
server.listen(port, host, () => {
  log(
    `Вузол запущено: ${url}, висота ланцюга ${node.chain.length - 1}, адреса майнера ${wallet.address.slice(0, 12)}…`,
  );
  log(`Сусіди: ${node.peers.length > 0 ? node.peers.join(", ") : "немає"}`);

  // Одразу після старту дізнаємось у сусідів, чи є в них кращий ланцюг
  void node.syncAll().then((results) => {
    for (const [peer, result] of Object.entries(results)) {
      log(
        `Синхронізація з ${peer}: ${result.ok ? (result.adopted ? "перейшли на їхній ланцюг" : "змін немає") : result.reason}`,
      );
    }
  });
});
