/**
 * Проверка разработчика перед PR одной командой: только то, что изменено
 * относительно `origin/master`, без ключей живой базы.
 *
 *   npm run precheck
 *
 * Шаги: prettier --write по изменённым файлам, затем одновременно eslint, tsc --noEmit, vitest по
 * тестам, которых коснулись изменения (`vitest related`), плюс всегда `src/lib` и
 * `tests/db-columns.test.ts`, `tests/dialogs` и сканирующие тесты (подписи аудита, роли, кроны, переводы). В конце одна строка: «готово к PR» или что упало.
 * tests/integration и e2e сюда не входят никогда. Перед вливанием — полный
 * `verify` и e2e на сборке (CI нет).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { runSteps } from "./verify.ts";

export interface Step {
  name: string;
  cmd: string[];
  /** Идёт одновременно с соседними такими же шагами (после prettier --write). */
  parallel?: boolean;
}

export interface Plan {
  /** prettier --write: всё, что он понимает. */
  format: string[];
  /** eslint: только код. */
  lint: string[];
  /** vitest related: код и тесты, кроме живых и e2e. */
  related: string[];
}

/** Что всегда прогоняется целиком: замки от возврата PR (CLAUDE.md, «Перед PR»). */
export const ALWAYS_TESTS = [
  "src/lib",
  "tests/db-columns.test.ts",
  "tests/dialogs",
  // Сканирующие тесты: новая функция админки без подписи аудита или роли, новый крон вне JOBS,
  // новая строка без перевода. Без них master краснел в 18-й (около 2,5 с к прогону).
  "src/app/admin/audit-labels.test.ts",
  "src/app/admin/accountant-access.test.ts",
  "src/lib/cron-route.test.ts",
  "src/app/i18n",
];

const FORMATTED = /\.(ts|tsx|js|mjs|cjs|json|md|css|yml|yaml)$/;
const CODE = /\.(ts|tsx|js|mjs|cjs)$/;
const SOURCE = /\.(ts|tsx)$/;
/** Не запускается никогда: живые тесты и сквозные прогоны браузера. */
const NEVER_RUN = /^tests\/(integration|e2e)\//;
/** Сгенерированное и собранное — не наше. */
const GENERATED = /(^|\/)(routeTree\.gen\.ts|package-lock\.json)$|^(\.output|node_modules|dist)\//;

/** Какие из изменённых файлов куда попадают. Порядок входа сохраняется, повторы убираются. */
export function plan(changed: string[]): Plan {
  const files = [...new Set(changed)].filter((f) => f && !GENERATED.test(f));
  return {
    format: files.filter((f) => FORMATTED.test(f)),
    lint: files.filter((f) => CODE.test(f)),
    related: files.filter((f) => SOURCE.test(f) && !NEVER_RUN.test(f)),
  };
}

export function steps(p: Plan): Step[] {
  const list: Step[] = [];
  if (p.format.length)
    list.push({ name: "prettier", cmd: ["npx", "prettier", "--write", ...p.format] });
  // prettier правит файлы, поэтому он первым и один; остальное только читает и идёт разом.
  if (p.lint.length)
    list.push({
      name: "eslint",
      cmd: [
        "npx",
        "eslint",
        "--cache",
        "--cache-strategy",
        "content",
        "--cache-location",
        "node_modules/.cache/eslint/",
        ...p.lint,
      ],
      parallel: true,
    });
  list.push({ name: "e2e-скан", cmd: ["node", "scripts/e2e-scan.ts"], parallel: true });
  list.push({ name: "typecheck", cmd: ["npm", "run", "typecheck"], parallel: true });
  const exclude = ["--exclude", "tests/integration/**", "--exclude", "tests/e2e/**"];
  if (p.related.length)
    list.push({
      name: "tests (изменённые)",
      cmd: ["npx", "vitest", "related", ...p.related, "--run", ...exclude],
      parallel: true,
    });
  list.push({
    name: "tests (src/lib, db-columns)",
    cmd: ["npx", "vitest", "run", ...ALWAYS_TESTS, ...exclude],
    parallel: true,
  });
  return list;
}

/** Последняя строка: «готово к PR» или какие шаги упали. */
export function verdict(results: { name: string; ok: boolean }[]): string {
  const failed = results.filter((r) => !r.ok).map((r) => r.name);
  return failed.length ? `не готово к PR: упало ${failed.join(", ")}` : "готово к PR";
}

function git(args: string[]): string[] {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return r.status === 0 ? r.stdout.split("\n").filter(Boolean) : [];
}

/** Изменения относительно origin/master: закоммиченные, в рабочем дереве и новые файлы. */
export function changedFiles(): string[] {
  const all = [
    ...git(["diff", "--name-only", "--diff-filter=d", "origin/master...HEAD"]),
    ...git(["diff", "--name-only", "--diff-filter=d", "HEAD"]),
    ...git(["ls-files", "--others", "--exclude-standard"]),
  ];
  return all.filter((f) => existsSync(f));
}

async function main(): Promise<number> {
  const p = plan(changedFiles());
  console.log(
    `Изменено: форматирование ${p.format.length}, eslint ${p.lint.length}, тесты по изменённым ${p.related.length}.`,
  );
  // Сначала чиним первую ошибку: после упавшей пачки дальше не идём.
  const results = await runSteps(steps(p));
  console.log(`\n${verdict(results)}`);
  return results.every((r) => r.ok) ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main());
