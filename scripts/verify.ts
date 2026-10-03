/**
 * Проверка перед PR без GitHub Actions: lint, типы, тесты и сборка одной
 * командой, окружение без ключей живой базы, короткая сводка для описания PR.
 *
 *   npm run verify              — всё, включая сборку
 *   npm run verify -- --no-build — без сборки (разработчик; сборку гонит Контрольный)
 *
 * tests/integration и e2e сюда не входят: живые тесты — только по заказу
 * интегратора, e2e — отдельной командой, если менялся интерфейс.
 */
import { spawnSync } from "node:child_process";

export interface Step {
  name: string;
  cmd: string[];
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
    { name: "lint", cmd: ["npm", "run", "lint"] },
    { name: "typecheck", cmd: ["npm", "run", "typecheck"] },
    { name: "test", cmd: ["npm", "test"] },
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

function main(): number {
  const withBuild = !process.argv.includes("--no-build");
  const results: StepResult[] = [];
  for (const step of steps(withBuild)) {
    console.log(`\n▶ ${step.name}: ${step.cmd.join(" ")}`);
    const started = Date.now();
    const [bin, ...args] = withoutLiveKeys(step.cmd);
    const run = spawnSync(bin!, args, { stdio: "inherit" });
    results.push({ name: step.name, ok: run.status === 0, seconds: (Date.now() - started) / 1000 });
    if (run.status !== 0) break;
  }
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

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
