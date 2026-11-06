import { runCli } from "./cli/run.ts";

// Точка входу консольної утиліти: node src/cli.ts <команда> [аргументи] [--node адреса] [--wallet файл]
process.exitCode = await runCli(process.argv.slice(2), (line) =>
  console.log(line),
);
