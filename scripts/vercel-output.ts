/**
 * Сборка для Vercel в verify: прод собирается пресетом vercel (одна функция,
 * шрифт сертификата внутри), а обычная сборка — node-server, и поломки именно
 * Vercel-варианта (ссылки наружу функции, нет шрифта) она не видит.
 *
 *   node scripts/vercel-output.ts
 *
 * Собирает с NITRO_PRESET=vercel, переносит `.vercel/output` во временную
 * папку (рабочее дерево не засоряется, `vercel deploy --prebuilt` не подхватит
 * чужую сборку), проверяет её двумя скриптами и убирает за собой.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const VERCEL_BUILD = ["env", "NITRO_PRESET=vercel", "npx", "vite", "build"];
const BUILT = ".vercel/output";

/** Проверки сборки; последний аргумент — папка functions внутри временной сборки. */
export function checks(functionsDir: string): { name: string; cmd: string[] }[] {
  return [
    { name: "check-vercel-output", cmd: ["node", "scripts/check-vercel-output.mjs", functionsDir] },
    { name: "certificate-output", cmd: ["node", "scripts/certificate-output.ts", functionsDir] },
  ];
}

function run(cmd: string[]): boolean {
  const [bin, ...args] = cmd;
  return spawnSync(bin!, args, { stdio: "inherit" }).status === 0;
}

function main(): number {
  if (existsSync(BUILT)) rmSync(BUILT, { recursive: true, force: true });
  if (!run(VERCEL_BUILD)) return 1;
  if (!existsSync(BUILT)) {
    console.error(`vercel-output: сборка не создала ${BUILT}`);
    return 1;
  }
  const tmp = mkdtempSync(join(tmpdir(), "frogflow-vercel-"));
  try {
    cpSync(BUILT, join(tmp, "output"), { recursive: true, verbatimSymlinks: true });
    rmSync(BUILT, { recursive: true, force: true });
    let ok = true;
    for (const c of checks(join(tmp, "output", "functions"))) {
      console.log(`\n▶ ${c.name}`);
      if (!run(c.cmd)) ok = false;
    }
    return ok ? 0 : 1;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
