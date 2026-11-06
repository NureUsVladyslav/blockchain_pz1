// Запускає кілька вузлів як окремі процеси на різних портах однією командою: npm run network
// Кількість вузлів: змінна NODES (за замовчуванням 3), перший порт: BASE_PORT (за замовчуванням 3001).
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

const count = Number(process.env.NODES ?? 3);
const basePort = Number(process.env.BASE_PORT ?? 3001);
if (!Number.isInteger(count) || count < 1)
  throw new Error("NODES має бути додатним цілим числом");

const urls = Array.from(
  { length: count },
  (_, i) => `http://localhost:${basePort + i}`,
);
const children: ChildProcess[] = [];

urls.forEach((url, i) => {
  const port = basePort + i;
  const peers = urls.filter((other) => other !== url).join(",");
  const child = spawn(process.execPath, ["src/main.ts"], {
    env: {
      ...process.env,
      PORT: String(port),
      NODE_URL: url,
      PEERS: peers,
      WALLET_FILE: `wallets/node${i + 1}.json`,
    },
    stdio: "inherit",
  });
  child.on("exit", (code) =>
    console.log(`Вузол на порту ${port} завершився з кодом ${code}`),
  );
  children.push(child);
});

process.on("SIGINT", () => {
  for (const child of children) child.kill();
  process.exit(0);
});
