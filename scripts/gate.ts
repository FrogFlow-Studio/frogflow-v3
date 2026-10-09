/**
 * Ворота перед вливанием (CI нет, решение Якова 09.10.2026): precheck и e2e тех
 * разделов, что тронуты (`scripts/e2e-select.ts`), на сборке node-server.
 *
 *   npm run gate            # перед каждым вливанием
 *   npm run gate -- --full  # раз в день и перед рискованным вливанием: verify и все e2e
 *
 * В конце одна строка: «можно вливать» или что упало.
 */
import { spawn } from "node:child_process";
import { changedFiles } from "./precheck.ts";
import { loadProject, select } from "./e2e-select.ts";
import { withoutLiveKeys } from "./verify.ts";

const E2E_WORKERS = "4";

function run(name: string, cmd: string[]): Promise<boolean> {
  const started = Date.now();
  console.log(`\n▶ ${name}`);
  const [bin = "env", ...args] = withoutLiveKeys(cmd);
  return new Promise((done) => {
    const child = spawn(bin, args, { stdio: "inherit" });
    child.on("close", (code) => {
      const sec = Math.round((Date.now() - started) / 1000);
      console.log(`${code === 0 ? "✅" : "❌"} ${name} — ${sec} с`);
      done(code === 0);
    });
  });
}

async function main(): Promise<number> {
  const full = process.argv.includes("--full");
  const started = Date.now();
  const sel = full
    ? { mode: "all" as const, reason: "--full" }
    : select(changedFiles(), loadProject());
  console.log(
    sel.mode === "some"
      ? `e2e: ${sel.specs.length} файлов (${sel.reason})\n  ${sel.specs.join("\n  ")}`
      : sel.mode === "all"
        ? `e2e: все (${sel.reason})`
        : `e2e: не нужны (${sel.reason})`,
  );

  const failed: string[] = [];
  // По очереди: сборка рядом с тестами отнимает у них ядра, и сканирующие тесты
  // (src/lib/db-errors.test.ts, ~13 с) упирались в тайм-аут 30 с.
  const okChecks = await (full
    ? run("verify", ["npm", "run", "verify"])
    : run("precheck", ["npm", "run", "precheck"]));
  if (!okChecks) failed.push(full ? "verify" : "precheck");
  // Первую ошибку чиним до e2e: дальше не идём.
  const okBuild =
    !okChecks ||
    sel.mode === "none" ||
    (await run("сборка для e2e", [
      // env ставит переменные сам: process.env читается только в src/config/env.ts.
      "NITRO_PRESET=node-server",
      "APP_URL=https://ci.invalid",
      "npx",
      "vite",
      "build",
    ]));
  if (!okBuild) failed.push("сборка");
  if (okChecks && okBuild && sel.mode !== "none") {
    const specs = sel.mode === "some" ? sel.specs : [];
    const ok = await run("e2e", [
      "npx",
      "playwright",
      "test",
      ...specs,
      `--workers=${E2E_WORKERS}`,
      "--reporter=dot",
    ]);
    if (!ok) failed.push("e2e");
  }

  const min = ((Date.now() - started) / 60000).toFixed(1);
  console.log(
    failed.length
      ? `\nнельзя вливать: упало ${failed.join(", ")} (${min} мин)`
      : `\nможно вливать (${min} мин)`,
  );
  return failed.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main());
