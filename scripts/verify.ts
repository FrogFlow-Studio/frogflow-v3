/**
 * Проверка перед PR без GitHub Actions: lint, типы, тесты и сборка одной
 * командой, окружение без ключей живой базы, короткая сводка для описания PR.
 *
 *   npm run verify              — всё, включая сборку
 *   npm run verify -- --no-build — без сборки (разработчик)
 *
 * tests/integration и e2e сюда не входят: живые тесты — только по заказу
 * интегратора, e2e — отдельной командой, если менялся интерфейс.
 */
import { spawn, spawnSync } from "node:child_process";

export interface Step {
  name: string;
  cmd: string[];
  /** Идёт одновременно с соседними такими же шагами; вывод печатается целиком по окончании. */
  parallel?: boolean;
}

export interface StepResult {
  name: string;
  ok: boolean;
  seconds: number;
}

/** Ключи живой базы, которые у новых веток есть в окружении (CLAUDE.md, «Проверки без ключей»). */
export const LIVE_KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_JWT_SECRET"];

/**
 * Команда под `env -u КЛЮЧ …`: ключи живой базы убираются у дочернего процесса,
 * а `process.env` скрипт не читает (правило 2 в CLAUDE.md).
 */
export function withoutLiveKeys(cmd: string[]): string[] {
  return ["env", ...LIVE_KEYS.flatMap((key) => ["-u", key]), ...cmd];
}

export function steps(withBuild: boolean): Step[] {
  const list: Step[] = [
    { name: "lint", cmd: ["npm", "run", "lint"], parallel: true },
    { name: "typecheck", cmd: ["npm", "run", "typecheck"], parallel: true },
    { name: "test", cmd: ["npm", "test"], parallel: true },
  ];
  // Типы уже проверены шагом выше, поэтому не `npm run build` (он проверит их второй раз).
  if (withBuild) {
    list.push({ name: "build", cmd: ["npx", "vite", "build"] });
    list.push({ name: "build-output", cmd: ["node", "scripts/check-vercel-output.mjs"] });
    list.push({
      name: "certificate-output",
      cmd: ["node", "scripts/certificate-output.ts", ".output/server"],
    });
    // Дымовой прогон собранного сервера на подставной базе (scripts/smoke.ts).
    list.push({ name: "smoke", cmd: ["npm", "run", "smoke"] });
    // Прод собирается пресетом vercel: собрать его отдельно и проверить функцию.
    list.push({ name: "vercel-output", cmd: ["node", "scripts/vercel-output.ts"] });
  }
  return list;
}

/** Сводка в markdown — вставляется в описание PR. */
export function summary(results: StepResult[], commit: string, skipped: string[]): string {
  const lines = [`Проверено на коммите ${commit} (\`npm run verify\`, без ключей живой базы):`, ""];
  for (const r of results) {
    lines.push(`- ${r.ok ? "✅" : "❌"} ${r.name} — ${r.seconds.toFixed(0)} с`);
  }
  for (const name of skipped) lines.push(`- ⏭ ${name} — не запускалось`);
  const failed = results.filter((r) => !r.ok);
  lines.push(
    "",
    failed.length ? `Упало: ${failed.map((r) => r.name).join(", ")}.` : "Всё зелёное.",
  );
  return lines.join("\n");
}

/** Подряд идущие шаги с `parallel` — одна пачка, остальные по одному. */
export function batches<T extends Step>(list: T[]): T[][] {
  const out: T[][] = [];
  for (const step of list) {
    const last = out.at(-1);
    if (step.parallel && last?.[0]?.parallel) last.push(step);
    else out.push([step]);
  }
  return out;
}

function runOne(step: Step, buffered: boolean): Promise<StepResult> {
  const started = Date.now();
  const [bin, ...args] = withoutLiveKeys(step.cmd);
  if (!buffered) console.log(`\n▶ ${step.name}: ${step.cmd.join(" ")}`);
  const child = spawn(bin!, args, { stdio: buffered ? ["ignore", "pipe", "pipe"] : "inherit" });
  const chunks: Buffer[] = [];
  child.stdout?.on("data", (c: Buffer) => chunks.push(c));
  child.stderr?.on("data", (c: Buffer) => chunks.push(c));
  return new Promise((done) => {
    child.on("close", (code) => {
      const seconds = (Date.now() - started) / 1000;
      if (buffered) {
        console.log(`\n▶ ${step.name}: ${step.cmd.join(" ")} (${seconds.toFixed(0)} с)`);
        process.stdout.write(Buffer.concat(chunks));
      }
      done({ name: step.name, ok: code === 0, seconds });
    });
  });
}

/** Пачки по очереди, шаги пачки одновременно; после упавшей пачки дальше не идём. */
export async function runSteps(list: Step[]): Promise<StepResult[]> {
  const results: StepResult[] = [];
  for (const batch of batches(list)) {
    const done = await Promise.all(batch.map((s) => runOne(s, batch.length > 1)));
    results.push(...done);
    if (done.some((r) => !r.ok)) break;
  }
  return results;
}

async function main(): Promise<number> {
  const withBuild = !process.argv.includes("--no-build");
  const results = await runSteps(steps(withBuild));
  const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
  }).stdout.trim();
  const skipped = withBuild ? [] : ["build"];
  // Шаги после упавшего не запускались — сводка должна об этом сказать.
  for (const s of steps(withBuild)) {
    if (!results.some((r) => r.name === s.name) && !skipped.includes(s.name)) skipped.push(s.name);
  }
  console.log(`\n${summary(results, commit || "?", skipped)}`);
  return results.every((r) => r.ok) ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main());
