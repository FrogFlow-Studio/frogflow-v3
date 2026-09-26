/**
 * Счётчик готовности по описи v1.
 *
 * Опись `docs/inherited-knowledge.md` — 51 поломка и 1074 проверки v1.
 * `docs/readiness.json` говорит про каждую, чем она закрыта в v2:
 *
 *   "tests/x.test.ts › имя теста"  — покрыта тестом v2 (файл и имя проверяются);
 *   "drop: причина"               — в v2 не нужна (поведение убрано или заменено);
 *   "later: причина"              — нужна, но не первым клиентам (модуль не перенесён);
 *   "open: заметка" или ничего    — дыра: v2 это не проверяет.
 *
 * Ключ `*` в группе — значение для всех её пунктов, не названных явно.
 * Сводка — `docs/READINESS.md`:
 *
 *   node scripts/readiness.ts          — пересобрать сводку
 *   node scripts/readiness.ts --check  — только сверить (то же делает npm test)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const FIX_GROUP = "fix";

/** Файлы описи про путь заказа: каталог → цена → оформление → оплата и чек → выдача. */
export const ORDER_PATH = [
  "tests/receipt-verify.test.ts",
  "tests/receipt-ocr-auto.test.ts",
  "tests/payment-proof.test.ts",
  "tests/direct-receipt-download.test.ts",
  "tests/pricing.test.ts",
  "tests/currency.test.ts",
  "tests/orders-pure.test.ts",
  "tests/bot-order-placement.test.ts",
  "tests/order-platform.test.ts",
  "tests/fulfillment.test.ts",
  "tests/fulfillment-reminder.test.ts",
  "tests/fulfillment-dates.test.ts",
  "tests/fulfillment-kind.test.ts",
  "tests/delivery-zones.test.ts",
  "tests/delivery-message.test.ts",
  "tests/direct-purchase.test.ts",
  "tests/direct-flow.test.ts",
  "tests/whatsapp-catalog.test.ts",
  "tests/zernio-inbox-order.test.ts",
  "tests/direct-reply.test.ts",
  "tests/mini-app-catalog.test.ts",
  "tests/mini-app-regressions.test.ts",
  "tests/mini-app-library.test.ts",
  "tests/mini-app-related.test.ts",
  "tests/mini-app-rate-limit.test.ts",
  "tests/telegram-webapp-init-data.test.ts",
  "tests/web-storefront-handoff.test.ts",
  "tests/product-materials.test.ts",
  "tests/admin-order-notify.test.ts",
  "tests/robokassa.test.ts",
  "tests/loyalty.test.ts",
  "tests/gift-certificates.test.ts",
];

export type Item = { group: string; key: string };
export type Status = "covered" | "open" | "later" | "drop";
export type Verdict = Item & { status: Status; ref: string | null; live: boolean };
export type Mapping = Record<string, Record<string, string>>;

/** Пункты описи в порядке файла. Одинаковые имена в группе — «имя #2». */
export function parseInventory(md: string): Item[] {
  const items: Item[] = [];
  let section: "fix" | "check" | null = null;
  let group: string | null = null;
  const seen = new Map<string, number>();
  for (const line of md.split("\n")) {
    if (line.startsWith("## Поломки")) section = "fix";
    else if (line.startsWith("## Требования")) section = "check";
    else if (line.startsWith("## ")) section = null;
    if (section === "fix" && line.startsWith("### ")) {
      items.push({ group: FIX_GROUP, key: line.slice(4).trim() });
    } else if (section === "check" && line.startsWith("### ")) {
      group = line.slice(4).trim().replace(/^`|`$/g, "");
    } else if (section === "check" && group && line.startsWith("- ")) {
      const text = line.slice(2).trim();
      const n = (seen.get(`${group}\n${text}`) ?? 0) + 1;
      seen.set(`${group}\n${text}`, n);
      items.push({ group, key: n === 1 ? text : `${text} #${n}` });
    }
  }
  return items;
}

const REF = /^(\S+\.test\.tsx?) › (.+)$/;

/** Сверка сопоставления с описью и тестами; `read` отдаёт файл репозитория или null. */
export function evaluate(
  items: Item[],
  mapping: Mapping,
  read: (path: string) => string | null,
): { verdicts: Verdict[]; errors: string[] } {
  const errors: string[] = [];
  const known = new Map<string, Set<string>>();
  for (const it of items) {
    if (!known.has(it.group)) known.set(it.group, new Set());
    known.get(it.group)!.add(it.key);
  }
  for (const [group, entries] of Object.entries(mapping)) {
    const keys = known.get(group);
    if (!keys) {
      errors.push(`нет в описи группы «${group}»`);
      continue;
    }
    for (const key of Object.keys(entries))
      if (key !== "*" && !keys.has(key)) errors.push(`${group}: нет в описи пункта «${key}»`);
  }
  const files = new Map<string, string | null>();
  const verdicts = items.map((it): Verdict => {
    const value = mapping[it.group]?.[it.key] ?? mapping[it.group]?.["*"];
    const where = `${it.group}: «${it.key}»`;
    if (value === undefined) return { ...it, status: "open", ref: null, live: false };
    const tag = value.match(/^(drop|later|open):\s*(.+)$/);
    if (tag) return { ...it, status: tag[1] as Status, ref: tag[2]!, live: false };
    const m = value.match(REF);
    if (!m) {
      errors.push(`${where}: не понимаю «${value}»`);
      return { ...it, status: "open", ref: null, live: false };
    }
    const [, path, name] = m as unknown as [string, string, string];
    if (!files.has(path)) files.set(path, read(path));
    const src = files.get(path);
    if (src == null) errors.push(`${where}: нет файла ${path}`);
    else if (!src.includes(name)) errors.push(`${where}: в ${path} нет теста «${name}»`);
    return { ...it, status: "covered", ref: value, live: path.startsWith("tests/integration/") };
  });
  return { verdicts, errors };
}

type Counts = Record<Status, number> & { total: number; live: number };

function count(vs: Verdict[]): Counts {
  const c: Counts = { total: vs.length, covered: 0, open: 0, later: 0, drop: 0, live: 0 };
  for (const v of vs) {
    c[v.status]++;
    if (v.live) c.live++;
  }
  return c;
}

/** Готовность для первых клиентов: покрыто из нужного сейчас (без later и drop). */
export function readiness(c: Counts): number {
  const need = c.covered + c.open;
  return need === 0 ? 100 : Math.floor((c.covered / need) * 1000) / 10;
}

const pct = (n: number) => `${String(n).replace(".", ",")} %`;
const cell = (s: string) => s.replace(/\|/g, "\\|");

export function renderReport(verdicts: Verdict[]): string {
  const all = count(verdicts);
  const groups = [...new Set(verdicts.map((v) => v.group))];
  const order = count(verdicts.filter((v) => ORDER_PATH.includes(v.group)));
  const out: string[] = [
    "# Готовность v2 по описи v1",
    "",
    "Собирается командой `node scripts/readiness.ts` из `docs/inherited-knowledge.md`",
    "и `docs/readiness.json` — руками не правится. `npm test` падает, если сводка",
    "устарела, пункт описи назван неверно или указанного теста нет.",
    "",
    `**Готовность для первых клиентов: ${pct(readiness(all))}** — покрыто тестами v2`,
    `${all.covered} из ${all.covered + all.open} нужных сейчас пунктов.`,
    "",
    `**Путь заказа: ${pct(readiness(order))}** — ${order.covered} из ${order.covered + order.open}`,
    "(каталог, цена, оформление, оплата и чек, выдача; файлы — `ORDER_PATH` в скрипте).",
    "",
    "| всего | покрыто | из них живыми тестами | дыра | позже | не нужно в v2 |",
    "| ----- | ------- | --------------------- | ---- | ----- | ------------- |",
    `| ${all.total} | ${all.covered} | ${all.live} | ${all.open} | ${all.later} | ${all.drop} |`,
    "",
    "«Позже» — поведение нужно, но не магазинам, которые переезжают первыми",
    "(модуль ещё не перенесён). «Не нужно в v2» — поведение убрано или заменено;",
    "причина записана в `docs/readiness.json`.",
    "",
    "## По файлам описи",
    "",
    "| файл v1 | всего | покрыто | дыра | позже | не нужно | готовность |",
    "| ------- | ----- | ------- | ---- | ----- | -------- | ---------- |",
  ];
  for (const g of groups) {
    const c = count(verdicts.filter((v) => v.group === g));
    const name = g === FIX_GROUP ? "поломки v1 (fix)" : `\`${g}\``;
    out.push(
      `| ${name} | ${c.total} | ${c.covered} | ${c.open} | ${c.later} | ${c.drop} | ${c.covered + c.open ? pct(readiness(c)) : "—"} |`,
    );
  }
  const open = verdicts.filter((v) => v.status === "open");
  out.push("", `## Дыры (${open.length})`, "");
  if (!open.length) out.push("Нет.");
  for (const g of groups) {
    const gs = open.filter((v) => v.group === g);
    if (!gs.length) continue;
    out.push(`### ${g === FIX_GROUP ? "поломки v1" : `\`${g}\``}`, "");
    for (const v of gs) out.push(`- ${cell(v.key)}${v.ref ? ` — ${cell(v.ref)}` : ""}`);
    out.push("");
  }
  return out.join("\n").trimEnd() + "\n";
}

export const PATHS = {
  inventory: "docs/inherited-knowledge.md",
  mapping: "docs/readiness.json",
  report: "docs/READINESS.md",
};

export function run(root: string) {
  const readRepo = (p: string) => {
    const f = join(root, p);
    return existsSync(f) ? readFileSync(f, "utf8") : null;
  };
  const items = parseInventory(readRepo(PATHS.inventory) ?? "");
  const mapping = JSON.parse(readRepo(PATHS.mapping) ?? "{}") as Mapping;
  const { verdicts, errors } = evaluate(items, mapping, readRepo);
  return {
    items,
    verdicts,
    errors,
    report: renderReport(verdicts),
    current: readRepo(PATHS.report),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.cwd();
  const r = run(root);
  for (const e of r.errors) console.error(e);
  if (process.argv.includes("--check")) {
    if (r.current !== r.report) console.error(`${PATHS.report} устарел: node scripts/readiness.ts`);
    process.exit(r.errors.length || r.current !== r.report ? 1 : 0);
  }
  writeFileSync(join(root, PATHS.report), r.report);
  console.log(r.report.split("\n").slice(6, 8).join(" "));
  process.exit(r.errors.length ? 1 : 0);
}
