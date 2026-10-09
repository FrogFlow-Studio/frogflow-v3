/**
 * Какие e2e гонять перед вливанием (решение Якова 09.10.2026: precheck + e2e тех разделов,
 * что тронуты; полный прогон раз в день). По изменённым относительно `origin/master` файлам:
 *
 * - изменённый spec — он сам; фикстура или сид раздела — specs, которые берут её константы;
 * - код в `src` — маршруты, которые его импортируют (напрямую или через другие модули),
 *   и specs, где встречается адрес такого маршрута; плюс короткий дымовой набор;
 * - общее (раскладки, корень, конфиги, зависимости, общие помощники e2e) или модуль,
 *   который тянут больше `WIDE` маршрутов, — все e2e.
 *
 * Чего не нашёл выбор, ловит ежедневный полный прогон.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, posix } from "node:path";

export type Selection =
  | { mode: "none"; reason: string }
  | { mode: "all"; reason: string }
  | { mode: "some"; specs: string[]; reason: string };

/** Изменение любого из них трогает все страницы или весь прогон. */
export const GLOBAL = [
  /^package(-lock)?\.json$/,
  /^(vite|playwright)\.config\.ts$/,
  /^tsconfig\.json$/,
  /^tests\/e2e\/(helpers|seed|serve|pg-stub|fixtures)\.ts$/,
  /^src\/routes\/__root\.tsx$/,
  /^src\/(router|server|start|client)\.tsx?$/,
  /^src\/[^/]+\.css$/,
];

/** Главные пути, которые идут при любом изменении кода. */
export const SMOKE = [
  "tests/e2e/storefront.spec.ts",
  "tests/e2e/web-checkout.spec.ts",
  "tests/e2e/panels.spec.ts",
  "tests/e2e/landing.spec.ts",
];

/** Модуль, который тянут больше стольких маршрутов, общий: гоняем всё. */
export const WIDE = 25;

/** Серверная логика без разметки: широкий модуль отсюда не тянет за собой все e2e. */
export const BACKEND = /^src\/(core|channels|lib|config|db)\/.*\.ts$/;

const WILD = String.raw`(?:\$\{[^}]*\}|[A-Za-z0-9_-]+)`;
const END = String.raw`(?=["'\`?#$)\\]|$)`;

/** Сегменты адреса маршрута из имени файла TanStack Router (без расширения). */
export function routeSegments(file: string): string[] {
  const rel = file.replace(/^src\/routes\//, "").replace(/\.tsx?$/, "");
  const parts = rel
    .split("/")
    .flatMap((p) => p.replace(/\[\.\]/g, "§").split("."))
    .map((p) => p.replace(/§/g, "."));
  return parts
    .filter((p) => p !== "index" && p !== "route" && !p.startsWith("_"))
    .map((p) => (p.endsWith("_") ? p.slice(0, -1) : p));
}

/**
 * Как адрес маршрута выглядит в тексте spec: целиком (`/admin/orders/${id}`) или хвостом после
 * подставленного префикса (`${shop}/checkout`).
 */
export function routePattern(file: string): RegExp {
  const segs = routeSegments(file);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const part = (s: string) => (s.startsWith("$") ? WILD : esc(s));
  const full = "/" + segs.map(part).join("/") + END;
  const lastParam = segs.map((s) => s.startsWith("$")).lastIndexOf(true);
  const tail = segs.slice(lastParam + 1);
  const alts = [segs.length ? full : `["'\`]/${END}`];
  if (lastParam >= 0 && tail.length) alts.push(String.raw`\}/` + tail.map(part).join("/") + END);
  return new RegExp(alts.join("|"));
}

/** Файл-раскладка: у него есть дочерние маршруты (`admin._authed.tsx` → `admin._authed.*`). */
export function isLayout(route: string, routes: string[]): boolean {
  // Серверные маршруты (src/routes/api) ничего не вкладывают: /api/telegram/$botId
  // и /api/telegram/$botId/vip — два обработчика, а не раскладка всех страниц.
  if (route.startsWith("src/routes/api/")) return false;
  const stem = route.replace(/\.tsx?$/, "");
  return routes.some((r) => r !== route && r.startsWith(stem + "."));
}

const IMPORT =
  /(?:import|export)\s[^"']*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

/** Куда указывает импорт: `@/x` и относительные пути внутри src; пакеты — никуда. */
export function resolveImport(
  from: string,
  spec: string,
  exists: (f: string) => boolean,
): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = "src/" + spec.slice(2);
  else if (spec.startsWith(".")) base = posix.normalize(posix.join(posix.dirname(from), spec));
  else return null;
  const options = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  return options.find((f) => /\.tsx?$/.test(f) && exists(f)) ?? null;
}

/**
 * Кто кого импортирует, наоборот: модуль → его импортёры. `staticOnly` —
 * без `import()`: так подгружают код внутри серверной функции, а не рисуют.
 */
export function reverseImports(
  sources: Map<string, string>,
  exists: (f: string) => boolean,
  staticOnly = false,
): Map<string, Set<string>> {
  const rev = new Map<string, Set<string>>();
  for (const [file, text] of sources) {
    for (const m of text.matchAll(IMPORT)) {
      if (staticOnly && !m[1]) continue;
      const target = resolveImport(file, m[1] ?? m[2] ?? "", exists);
      if (!target) continue;
      if (!rev.has(target)) rev.set(target, new Set());
      rev.get(target)!.add(file);
    }
  }
  return rev;
}

/** Маршруты, до которых доходит изменение модуля по цепочке импортов. */
export function routesReaching(file: string, rev: Map<string, Set<string>>): Set<string> {
  const seen = new Set<string>([file]);
  const queue = [file];
  while (queue.length) {
    for (const up of rev.get(queue.pop()!) ?? []) {
      if (seen.has(up)) continue;
      seen.add(up);
      queue.push(up);
    }
  }
  return new Set([...seen].filter((f) => f.startsWith("src/routes/")));
}

export interface Project {
  /** Все specs: путь → текст. */
  specs: Map<string, string>;
  /** Весь код src (без тестов): путь → текст. */
  sources: Map<string, string>;
  /** Текст файлов фикстур и сида e2e по пути. */
  read: (f: string) => string;
  exists: (f: string) => boolean;
}

export function select(changed: string[], p: Project): Selection {
  const files = [...new Set(changed)];
  const global = files.find((f) => GLOBAL.some((re) => re.test(f)));
  if (global) return { mode: "all", reason: `общий файл ${global}` };

  const picked = new Set<string>();
  const why: string[] = [];
  let code = false;
  const routes = [...p.sources.keys()].filter((f) => f.startsWith("src/routes/"));
  let rev: Map<string, Set<string>> | null = null;
  let revStatic: Map<string, Set<string>> | null = null;

  for (const f of files) {
    if (/^tests\/e2e\/.*\.spec\.ts$/.test(f)) {
      if (p.specs.has(f)) picked.add(f);
      continue;
    }
    const part = f.match(/^tests\/e2e\/(fixtures|seed)\/(.+)\.ts$/);
    if (part) {
      // Константы раздела из фикстуры: их берут specs как F.NAME.
      const fixture = `tests/e2e/fixtures/${part[2]}.ts`;
      const names = p.exists(fixture)
        ? [...p.read(fixture).matchAll(/export (?:const|function) (\w+)/g)].map((m) => m[1])
        : [];
      const own = `tests/e2e/${part[2]}.spec.ts`;
      if (p.specs.has(own)) picked.add(own);
      for (const [spec, text] of p.specs)
        if (names.some((n) => new RegExp(`\\b${n}\\b`).test(text))) picked.add(spec);
      continue;
    }
    if (!/^src\/.*\.tsx?$/.test(f) || /\.test\.tsx?$/.test(f)) continue;
    code = true;
    rev ??= reverseImports(p.sources, p.exists);
    const reached = routesReaching(f, rev);
    if (reached.size > WIDE) {
      // Логика сервера (ядро, каналы, lib) доходит почти до всех страниц через серверные
      // функции; её проверяют unit-тесты precheck, а страницы — дымовой набор и ежедневный прогон.
      if (BACKEND.test(f)) {
        why.push(`${f} — серверная логика, дымовой набор`);
        continue;
      }
      return { mode: "all", reason: `${f} тянут ${reached.size} маршрутов` };
    }
    // Раскладка рисует модуль только по статическим импортам; через import() в
    // серверной функции (Telegram из витрины) страницы его не показывают.
    revStatic ??= reverseImports(p.sources, p.exists, true);
    const drawn = routesReaching(f, revStatic);
    for (const r of reached) {
      if (isLayout(r, routes) && drawn.has(r)) return { mode: "all", reason: `раскладка ${r}` };
      const re = routePattern(r);
      for (const [spec, text] of p.specs) if (re.test(text)) picked.add(spec);
    }
    why.push(`${f} → ${reached.size} маршр.`);
  }

  if (code) for (const s of SMOKE) if (p.specs.has(s)) picked.add(s);
  if (!picked.size) return { mode: "none", reason: "страницы и e2e не тронуты" };
  if (picked.size * 2 > p.specs.size)
    return { mode: "all", reason: `выбрано ${picked.size} из ${p.specs.size}` };
  return { mode: "some", specs: [...picked].sort(), reason: why.join("; ") || "изменены e2e" };
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const f = join(dir, name);
    if (statSync(f).isDirectory()) walk(f, out);
    else out.push(f);
  }
  return out;
}

/** Проект с диска (из корня репозитория). */
export function loadProject(): Project {
  const specs = new Map<string, string>();
  for (const f of readdirSync("tests/e2e"))
    if (f.endsWith(".spec.ts")) specs.set(`tests/e2e/${f}`, readFileSync(`tests/e2e/${f}`, "utf8"));
  const sources = new Map<string, string>();
  for (const f of walk("src"))
    if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && basename(dirname(f)) !== "__tests__")
      sources.set(f, readFileSync(f, "utf8"));
  return {
    specs,
    sources,
    read: (f) => readFileSync(f, "utf8"),
    exists: (f) => sources.has(f) || existsSync(f),
  };
}
