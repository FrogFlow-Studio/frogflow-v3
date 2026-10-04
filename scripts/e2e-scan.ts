/**
 * Статический скан сквозных тестов без запуска браузера (путь Е, Е4). Сид и фикстуры
 * склеены из десятков PR, поэтому ловим то, на чём Playwright или слияние падают поздно:
 *
 *   node scripts/e2e-scan.ts      (входит в `npm run precheck`; `--baseline` печатает счётчики для exact-baseline.json)
 *
 * 1. одинаковые имена `test(...)` в одном файле (Playwright отказывается стартовать);
 * 2. `getByRole(..., { name: "текст" })` без `exact: true`: после «Войти через Telegram»
 *    14 из 60 тестов искали «Войти» и находили две кнопки (#292). Старые места записаны
 *    в `tests/e2e/exact-baseline.json` и не растут, в новых файлах их быть не должно;
 * 3. `tests/e2e/seed.ts` и `fixtures.ts` — только строки импорта, вызова и экспорта; у каждого
 *    файла из `seed/` и `fixtures/` есть своя строка, вызов один, повтор имени — ошибка;
 * 4. одно и то же имя, экспортируемое двумя файлами `fixtures/`: `export *` молча выкидывает его.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Files = Record<string, string>;
export type Baseline = Record<string, number>;

const ROOT = "tests/e2e";
const BASELINE = `${ROOT}/exact-baseline.json`;

const clean = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

/** Имена тестов файла (`test(`, `test.only(`, `test.skip(`, `test.fixme(`). */
export function testTitles(src: string): string[] {
  const out: string[] = [];
  const re = /\btest(?:\.(?:only|skip|fixme))?\(\s*(["'`])((?:(?!\1)[^\\]|\\.)*)\1/g;
  for (let m = re.exec(clean(src)); m; m = re.exec(clean(src))) out.push(m[2]!);
  return out;
}

/** Сколько `getByRole(role, { name: "строка" })` без `exact: true` (регулярные имена не считаем). */
export function looseRoleNames(src: string): number {
  let n = 0;
  const re = /getByRole\(\s*(["'`])[\w-]+\1\s*,\s*\{([^}]*)\}/g;
  for (const m of clean(src).matchAll(re)) {
    const body = m[2]!;
    if (/\bname:\s*["'`]/.test(body) && !/\bexact:\s*true\b/.test(body)) n++;
  }
  return n;
}

const COMMENT = /^\s*(\/\*\*?|\*\/?|\/\/|\*)/;

/** Строки общего `seed.ts`: импорт, вызов раздела, каркас функции. */
export function seedShape(src: string): string[] {
  const problems: string[] = [];
  const imported = new Map<string, string>();
  const called: string[] = [];
  for (const [i, raw] of src.split("\n").entries()) {
    const line = raw.trim();
    if (!line || COMMENT.test(line)) continue;
    const imp = line.match(
      /^import\s+(?:\{\s*([\w\s,]+?)\s*\}|type\s+\{[^}]*\}|\w+)\s+from\s+"(\.\/[^"]+)";?$/,
    );
    if (imp) {
      for (const name of (imp[1] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)) {
        if (/^seed[A-Z0-9]/.test(name)) {
          if (imported.has(name)) problems.push(`seed.ts:${i + 1}: ${name} импортирован дважды`);
          imported.set(name, imp[2]!);
        }
      }
      continue;
    }
    if (/^import\s.*from\s+"\.\/pg-stub\.ts";?$/.test(line)) continue;
    const call = line.match(/^(seed\w+)\(db(?:,\s*now)?\);$/);
    if (call) {
      called.push(call[1]!);
      continue;
    }
    if (
      /^export function seedDb\(\): StubDb \{$/.test(line) ||
      line === "const db = stubDb();" ||
      line === "const now = new Date().toISOString();" ||
      line === "return db;" ||
      line === "}"
    )
      continue;
    problems.push(
      `seed.ts:${i + 1}: в общем сиде только импорт и вызов раздела, а тут «${line.slice(0, 60)}»`,
    );
  }
  const counts = new Map<string, number>();
  for (const c of called) counts.set(c, (counts.get(c) ?? 0) + 1);
  for (const [name, n] of counts) if (n > 1) problems.push(`seed.ts: ${name} вызван ${n} раза`);
  for (const [name, from] of imported)
    if (!counts.has(name)) problems.push(`seed.ts: ${name} (${from}) импортирован, но не вызван`);
  for (const name of counts.keys())
    if (!imported.has(name) && !/^seed(Base|Operator)$/.test(name))
      problems.push(`seed.ts: ${name} вызван без импорта`);
  return problems;
}

/** Строки общего `fixtures.ts`: только `export * from "./fixtures/x.ts"`, без повторов. */
export function fixturesShape(src: string): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of src.split("\n").entries()) {
    const line = raw.trim();
    if (!line || COMMENT.test(line)) continue;
    const m = line.match(/^export \* from "(\.\/fixtures\/[\w-]+\.ts)";$/);
    if (!m) {
      problems.push(
        `fixtures.ts:${i + 1}: в общем файле только «export * from», а тут «${line.slice(0, 60)}»`,
      );
      continue;
    }
    if (seen.has(m[1]!)) problems.push(`fixtures.ts:${i + 1}: ${m[1]} экспортирован дважды`);
    seen.add(m[1]!);
  }
  return problems;
}

/** Каждому файлу из `dir` соответствует строка в общем файле. */
export function everyFileListed(
  dir: string,
  names: string[],
  shared: string,
  label: string,
): string[] {
  return names
    .filter((n) => n.endsWith(".ts") && n !== "util.ts" && !shared.includes(`./${dir}/${n}`))
    .map((n) => `${label}: файл ${dir}/${n} не подключён в ${label}`);
}

/** Одинаковые экспортируемые имена в разных файлах `fixtures/`. */
export function duplicateExports(files: Files): string[] {
  const owners = new Map<string, string[]>();
  for (const [file, src] of Object.entries(files)) {
    for (const m of clean(src).matchAll(/^export\s+(?:const|let|function|class|enum)\s+(\w+)/gm))
      owners.set(m[1]!, [...(owners.get(m[1]!) ?? []), file]);
  }
  return [...owners]
    .filter(([, f]) => f.length > 1)
    .map(
      ([name, f]) =>
        `fixtures: «${name}» экспортируют ${f.join(" и ")}: export * молча выкинет имя`,
    );
}

export interface Input {
  specs: Files;
  seed: string;
  fixtures: string;
  seedFiles: string[];
  fixtureFiles: Files;
  baseline: Baseline;
}

export function scan(i: Input): string[] {
  const problems: string[] = [];
  for (const [file, src] of Object.entries(i.specs)) {
    const seen = new Set<string>();
    for (const t of testTitles(src)) {
      if (seen.has(t)) problems.push(`${file}: тест «${t}» назван дважды (Playwright не стартует)`);
      seen.add(t);
    }
    const loose = looseRoleNames(src);
    const allowed = i.baseline[file] ?? 0;
    if (loose > allowed)
      problems.push(
        `${file}: getByRole с name без exact: true — ${loose}, разрешено ${allowed}; добавьте \`exact: true\``,
      );
  }
  problems.push(...seedShape(i.seed), ...fixturesShape(i.fixtures));
  problems.push(...everyFileListed("seed", i.seedFiles, i.seed, "seed.ts"));
  problems.push(
    ...everyFileListed(
      "fixtures",
      Object.keys(i.fixtureFiles).map((f) => f.split("/").pop()!),
      i.fixtures,
      "fixtures.ts",
    ),
  );
  problems.push(...duplicateExports(i.fixtureFiles));
  return problems;
}

const read = (p: string): string => readFileSync(p, "utf8");

export function load(): Input {
  const specs: Files = {};
  for (const f of readdirSync(ROOT)) {
    if (/\.(spec|ts)$/.test(f) && !f.startsWith("seed") && f !== "fixtures.ts")
      specs[`${ROOT}/${f}`] = read(join(ROOT, f));
  }
  const fixtureFiles: Files = {};
  for (const f of readdirSync(`${ROOT}/fixtures`))
    fixtureFiles[`${ROOT}/fixtures/${f}`] = read(join(ROOT, "fixtures", f));
  let baseline: Baseline = {};
  try {
    baseline = JSON.parse(read(BASELINE)) as Baseline;
  } catch {
    /* нет файла — baseline пуст */
  }
  return {
    specs,
    seed: read(`${ROOT}/seed.ts`),
    fixtures: read(`${ROOT}/fixtures.ts`),
    seedFiles: readdirSync(`${ROOT}/seed`),
    fixtureFiles,
    baseline,
  };
}

/** Текущие счётчики для `exact-baseline.json` (только файлы, где они не нули). */
export function currentBaseline(specs: Files): Baseline {
  const out: Baseline = {};
  for (const [f, src] of Object.entries(specs).sort(([a], [b]) => a.localeCompare(b))) {
    const n = looseRoleNames(src);
    if (n) out[f] = n;
  }
  return out;
}

function main(): number {
  const input = load();
  if (process.argv.includes("--baseline")) {
    console.log(JSON.stringify(currentBaseline(input.specs), null, 2));
    return 0;
  }
  const problems = scan(input);
  for (const p of problems) console.error(`✗ ${p}`);
  console.log(problems.length ? `e2e-скан: ${problems.length} замечаний` : "e2e-скан: чисто");
  return problems.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
