// Експеримент: як час майнінгу залежить від складності.
// Запуск: npm run experiment
// Налаштування (необов'язково): EXPERIMENT_BITS="8,12,16,20" (рівні складності в бітах), EXPERIMENT_RUNS=30 (запусків на рівень, мінімум 10)
// Результат: таблиця в консолі, results/experiment.csv (усі запуски) і results/experiment.svg (графік).
import { mkdirSync, writeFileSync } from "node:fs";
import { createBlock } from "../src/core/block.ts";
import { mineBlock } from "../src/core/pow.ts";
import { createReward } from "../src/core/reward.ts";
import { generateWallet } from "../src/core/wallet.ts";

const levels = (process.env.EXPERIMENT_BITS ?? "8,12,16,20")
  .split(",")
  .map((x) => Number(x.trim()));
const runs = Number(process.env.EXPERIMENT_RUNS ?? 30);
if (
  levels.length < 4 ||
  levels.some((x) => !Number.isInteger(x) || x < 1 || x > 40)
) {
  throw new Error(
    "EXPERIMENT_BITS: потрібно щонайменше 4 цілі рівні від 1 до 40, наприклад 8,12,16,20",
  );
}
if (!Number.isInteger(runs) || runs < 10)
  throw new Error("EXPERIMENT_RUNS: потрібно не менше 10 запусків на рівень");

interface Run {
  bits: number;
  run: number;
  attempts: number; // скільки значень nonce перебрано
  seconds: number;
}

// Один запуск: майнимо щоразу ІНШИЙ блок (інший майнер, інша мітка часу), інакше результат був би однаковим
function measure(bits: number, run: number): Run {
  const miner = generateWallet();
  const block = createBlock({
    index: 1,
    timestamp: 1_700_000_000_000 + run * 1000 + bits,
    previousHash: "0".repeat(64),
    difficulty: bits,
    transactions: [createReward(miner.address, [])],
  });
  const start = performance.now();
  const mined = mineBlock(block);
  const seconds = (performance.now() - start) / 1000;
  return { bits, run, attempts: mined.header.nonce + 1, seconds };
}

// Прогрів: перші запуски JavaScript виконує повільніше (код ще компілюється), що спотворило б найменший рівень.
// Тому спершу кілька разів майнимо блоки, час яких не записуємо.
for (let i = 0; i < 20; i++) measure(10, 1000 + i);

const all: Run[] = [];
console.log(
  `Експеримент: рівні складності (біти) ${levels.join(", ")}, запусків на рівень ${runs}`,
);
for (const bits of levels) {
  process.stdout.write(`  складність ${bits} бітів: `);
  for (let run = 0; run < runs; run++) {
    all.push(measure(bits, run));
    process.stdout.write(".");
  }
  process.stdout.write(" готово\n");
}

// --- Статистика ---
const mean = (xs: number[]): number =>
  xs.reduce((a, b) => a + b, 0) / xs.length;
const stdev = (xs: number[]): number => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};

interface Summary {
  bits: number;
  meanSeconds: number;
  stdSeconds: number;
  minSeconds: number;
  maxSeconds: number;
  meanAttempts: number;
  relError: number; // похибка середнього (σ / √n) у частках від середнього
}
const summary: Summary[] = levels.map((bits) => {
  const rows = all.filter((r) => r.bits === bits);
  const secs = rows.map((r) => r.seconds);
  return {
    bits,
    meanSeconds: mean(secs),
    stdSeconds: stdev(secs),
    minSeconds: Math.min(...secs),
    maxSeconds: Math.max(...secs),
    meanAttempts: mean(rows.map((r) => r.attempts)),
    relError: stdev(secs) / Math.sqrt(secs.length) / mean(secs),
  };
});

const fmt = (x: number): string =>
  x < 0.01 ? x.toExponential(2) : x.toFixed(x < 1 ? 3 : 2);
console.log("\nРезультати (час у секундах):");
console.log(
  "біти | hex-нулі | середній час | розкид (σ)  | мін      | макс     | сер. спроб   | теорія 2^біти | похибка середн. | відношення до попер. рівня",
);
summary.forEach((s, i) => {
  const prev = summary[i - 1];
  const ratio = prev
    ? `${(s.meanSeconds / prev.meanSeconds).toFixed(1)}× (біт додано ${s.bits - prev.bits}, теорія ${2 ** (s.bits - prev.bits)}×)`
    : "—";
  console.log(
    `${String(s.bits).padStart(4)} | ${(s.bits / 4).toFixed(1).padStart(8)} | ${fmt(s.meanSeconds).padStart(12)} | ${fmt(s.stdSeconds).padStart(11)} | ${fmt(s.minSeconds).padStart(8)} | ${fmt(s.maxSeconds).padStart(8)} | ${Math.round(s.meanAttempts).toString().padStart(12)} | ${String(2 ** s.bits).padStart(13)} | ${(s.relError * 100).toFixed(0).padStart(13)} % | ${ratio}`,
  );
});
const speed = mean(all.map((r) => r.attempts / r.seconds));
console.log(
  "\nПримітка: час одного блоку випадковий (розкид порівнянний із самим середнім), тому відношення між рівнями лише наближено дорівнює теоретичному; чим більше запусків, тим менша похибка середнього.",
);
console.log(
  `Швидкість цього комп'ютера: близько ${Math.round(speed).toLocaleString("uk-UA")} хешів за секунду`,
);

// --- CSV ---
mkdirSync("results", { recursive: true });
const csv = [
  "bits,hex_zeros,run,attempts,seconds",
  ...all.map(
    (r) =>
      `${r.bits},${r.bits / 4},${r.run + 1},${r.attempts},${r.seconds.toFixed(6)}`,
  ),
].join("\n");
writeFileSync("results/experiment.csv", csv + "\n", "utf8");

// --- Графік (SVG), логарифмічна вісь часу ---
const W = 900,
  H = 560,
  L = 90,
  R = 30,
  T = 60,
  B = 90;
const plotW = W - L - R,
  plotH = H - T - B;
const allSecs = all.map((r) => Math.max(r.seconds, 1e-6));
const yMinExp = Math.floor(Math.log10(Math.min(...allSecs)));
const yMaxExp = Math.ceil(Math.log10(Math.max(...allSecs)));
const bitsMin = Math.min(...levels),
  bitsMax = Math.max(...levels);
const x = (bits: number): number =>
  L + ((bits - bitsMin) / (bitsMax - bitsMin)) * plotW * 0.9 + plotW * 0.05;
const y = (sec: number): number =>
  T +
  plotH -
  ((Math.log10(Math.max(sec, 1e-6)) - yMinExp) / (yMaxExp - yMinExp)) * plotH;
const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

const parts: string[] = [];
parts.push(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Arial, sans-serif">`,
);
parts.push(`<rect width="${W}" height="${H}" fill="white"/>`);
parts.push(
  `<text x="${W / 2}" y="30" text-anchor="middle" font-size="18" font-weight="bold">Залежність часу майнінгу від складності (вісь часу логарифмічна)</text>`,
);
// сітка і підписи осі Y
for (let e = yMinExp; e <= yMaxExp; e++) {
  const yy = y(10 ** e);
  parts.push(
    `<line x1="${L}" y1="${yy}" x2="${W - R}" y2="${yy}" stroke="#ddd"/>`,
  );
  parts.push(
    `<text x="${L - 8}" y="${yy + 4}" text-anchor="end" font-size="12">${esc(`10^${e}`)}</text>`,
  );
}
// вісь X: підписи кожного виміряного рівня
for (const bits of levels) {
  const xx = x(bits);
  parts.push(
    `<line x1="${xx}" y1="${T}" x2="${xx}" y2="${T + plotH}" stroke="#eee"/>`,
  );
  parts.push(
    `<text x="${xx}" y="${T + plotH + 20}" text-anchor="middle" font-size="12">${bits}</text>`,
  );
  parts.push(
    `<text x="${xx}" y="${T + plotH + 36}" text-anchor="middle" font-size="11" fill="#555">(${(bits / 4).toFixed(bits % 4 === 0 ? 0 : 1)} hex-нулів)</text>`,
  );
}
parts.push(
  `<line x1="${L}" y1="${T}" x2="${L}" y2="${T + plotH}" stroke="black"/>`,
);
parts.push(
  `<line x1="${L}" y1="${T + plotH}" x2="${W - R}" y2="${T + plotH}" stroke="black"/>`,
);
parts.push(
  `<text x="${L + plotW / 2}" y="${H - 28}" text-anchor="middle" font-size="14">Складність, кількість нульових бітів на початку хешу</text>`,
);
parts.push(
  `<text transform="translate(22 ${T + plotH / 2}) rotate(-90)" text-anchor="middle" font-size="14">Час майнінгу одного блоку, с (логарифмічна шкала)</text>`,
);
// теоретична лінія: час росте як 2^біти, прив'язана до першого рівня
const first = summary[0] as Summary;
const theory = levels
  .map((b) => `${x(b)},${y(first.meanSeconds * 2 ** (b - first.bits))}`)
  .join(" ");
parts.push(
  `<polyline points="${theory}" fill="none" stroke="#c0392b" stroke-width="2" stroke-dasharray="6 5"/>`,
);
// окремі запуски (світлі точки)
for (const r of all) {
  const jitter = ((r.run % 5) - 2) * 3;
  parts.push(
    `<circle cx="${x(r.bits) + jitter}" cy="${y(r.seconds)}" r="3" fill="#2980b9" fill-opacity="0.35"/>`,
  );
}
// розкид мін-макс і середнє
for (const s of summary) {
  const xx = x(s.bits);
  parts.push(
    `<line x1="${xx}" y1="${y(s.minSeconds)}" x2="${xx}" y2="${y(s.maxSeconds)}" stroke="#1a5276" stroke-width="2"/>`,
  );
  parts.push(
    `<line x1="${xx - 8}" y1="${y(s.minSeconds)}" x2="${xx + 8}" y2="${y(s.minSeconds)}" stroke="#1a5276" stroke-width="2"/>`,
  );
  parts.push(
    `<line x1="${xx - 8}" y1="${y(s.maxSeconds)}" x2="${xx + 8}" y2="${y(s.maxSeconds)}" stroke="#1a5276" stroke-width="2"/>`,
  );
}
parts.push(
  `<polyline points="${summary.map((s) => `${x(s.bits)},${y(s.meanSeconds)}`).join(" ")}" fill="none" stroke="#1a5276" stroke-width="2"/>`,
);
for (const s of summary)
  parts.push(
    `<circle cx="${x(s.bits)}" cy="${y(s.meanSeconds)}" r="6" fill="#1a5276"/>`,
  );
const lx = L + 14,
  ly = T + 14;
parts.push(
  `<rect x="${lx - 8}" y="${ly - 14}" width="360" height="88" fill="white" stroke="#bbb"/>`,
);
parts.push(
  `<circle cx="${lx + 6}" cy="${ly}" r="6" fill="#1a5276"/><text x="${lx + 22}" y="${ly + 4}" font-size="12">Середній час за ${runs} запусків</text>`,
);
parts.push(
  `<line x1="${lx}" y1="${ly + 20}" x2="${lx + 12}" y2="${ly + 20}" stroke="#1a5276" stroke-width="2"/><text x="${lx + 22}" y="${ly + 24}" font-size="12">Розкид: від мінімуму до максимуму</text>`,
);
parts.push(
  `<circle cx="${lx + 6}" cy="${ly + 40}" r="3" fill="#2980b9" fill-opacity="0.5"/><text x="${lx + 22}" y="${ly + 44}" font-size="12">Окремі запуски</text>`,
);
parts.push(
  `<line x1="${lx}" y1="${ly + 60}" x2="${lx + 12}" y2="${ly + 60}" stroke="#c0392b" stroke-width="2" stroke-dasharray="4 3"/><text x="${lx + 22}" y="${ly + 64}" font-size="12">Теорія: час зростає як 2^складність (від першого рівня)</text>`,
);
parts.push("</svg>");
writeFileSync("results/experiment.svg", parts.join("\n"), "utf8");

console.log(
  "\nФайли: results/experiment.csv (усі запуски), results/experiment.svg (графік: відкрийте у браузері).",
);
