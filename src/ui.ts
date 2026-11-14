import { readFileSync } from "node:fs";
import { createUiServer } from "./ui/server.ts";

// Налаштування через змінні середовища
const port = Number(process.env.UI_PORT ?? "8080");
const nodes = (
  process.env.UI_NODES ??
  "http://localhost:3001,http://localhost:3002,http://localhost:3003"
)
  .split(",")
  .map((url) => url.trim())
  .filter((url) => url !== "");
const walletsDir = process.env.WALLETS_DIR ?? "wallets";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("UI_PORT має бути цілим числом від 1 до 65535");
  process.exit(1);
}
if (nodes.length === 0) {
  console.error("UI_NODES порожній: вкажіть адреси вузлів через кому");
  process.exit(1);
}

const html = readFileSync(new URL("./ui/index.html", import.meta.url), "utf8");

// Слухаємо тільки localhost: сервер має доступ до файлів гаманців
createUiServer({ nodes, walletsDir, html, port }).listen(
  port,
  "127.0.0.1",
  () => {
    console.log(`Інтерфейс: http://localhost:${port}`);
    console.log(`Вузли: ${nodes.join(", ")}`);
    console.log(`Гаманці: ${walletsDir}`);
  },
);
