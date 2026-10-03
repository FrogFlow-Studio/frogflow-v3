import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chunksOf, IN_CHUNK, inChunks } from "./in-chunks";

/**
 * Замок от возврата: список неизвестной длины в `.in(...)` уходит в адрес
 * запроса, и больше ~8 КБ (≈ 200 uuid) даёт 431 (CLAUDE.md, «Один раз» и
 * «Без молчаливых обрезок»). Безопасно: литерал и константа, `chunk` из
 * `inChunks`. Остальное — только из белого списка (файл → по причине на место,
 * по порядку в файле); число мест проверяется.
 */
export function unboundedIn(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/\.in\(/g)) {
    let depth = 0;
    let comma = -1;
    let end = -1;
    for (let i = m.index! + 3; i < source.length; i++) {
      const c = source[i];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      } else if (c === "," && depth === 1 && comma < 0) comma = i;
    }
    if (comma < 0 || end < 0) continue;
    const list = source
      .slice(comma + 1, end)
      .trim()
      .replace(/,$/, "")
      .trim();
    const safe =
      /^\[\s*["'`]/.test(list) || // литерал со строками
      (/^\[[\s\w.,]*\]$/.test(list) && !/[a-z]/.test(list.replace(/\.\.\./g, ""))) || // [A, B] или [...A]
      /^\[\.\.\.[A-Z_0-9]+\]$/.test(list) ||
      /^[A-Z_0-9]+$/.test(list) ||
      /^Object\.values\([A-Z_]+\)$/.test(list) ||
      /^chunk\b/.test(list) || // кусок из inChunks (или его ручной аналог)
      /\.slice\(/.test(list); // нарезка вручную: slice(i, i + N)
    if (!safe) out.push(list);
  }
  return out;
}

const FIXED = "список ключей — фиксированный набор из кода";
const PAGE = "список из одной страницы чтения (не больше её лимита)";
const FEW = "список из позиций одного заказа или одного покупателя — единицы";

const ALLOWED: Record<string, string[]> = {
  "src/app/admin/admin.functions.ts": [`${PAGE} (заказы из «Не доставлено», ≤ 200)`],
  "src/app/admin/invoice.server.ts": [FEW],
  "src/app/operator/ai-topup.server.ts": ["счета пополнения одного клиента — единицы"],
  "src/app/operator/health-alerts.server.ts": [FIXED, FIXED],
  "src/app/operator/operator.server.ts": ["один клиент: `extras([botId])`; без списка — все"],
  "src/app/operator/two-factor.server.ts": [FIXED, FIXED],
  "src/app/storefront/buyer-orders.server.ts": [`${PAGE} (страница заказов покупателя)`],
  "src/channels/zernio/automations.server.ts": [
    "комментарии одного автора под одним постом — единицы",
  ],
  "src/channels/zernio/ice-breakers.server.ts": [FIXED],
  "src/channels/zernio/message-failed.server.ts": [`${PAGE} (≤ 20 заказов)`],
  "src/core/broadcasts/broadcasts.ts": [
    "пакет получателей: BATCH_SIZE = 25",
    "пакет получателей: BATCH_SIZE = 25",
  ],
  "src/core/broadcasts/clicks.ts": [`${PAGE} (рассылки на экране, ≤ 50)`],
  "src/core/broadcasts/segments.ts": [FIXED],
  "src/core/customers/card.ts": [FEW, FEW, FEW],
  "src/core/delivery/watermark.server.ts": Array<string>(5).fill(
    "keys — кусок CHECK_CHUNK (100), нарезка у вызывающего",
  ),
  "src/core/inbox/inbox.ts": [`${PAGE} (диалоги на экране, ≤ 200)`],
  "src/core/notify/digest.ts": [`${PAGE} (пачка дайджеста, ≤ 100)`],
  "src/core/orders/admin.ts": ["заказы с недоплатой: UNDERPAID_LIST_MAX"],
  "src/core/orders/balance.ts": [FEW, FEW],
  "src/core/orders/orders.ts": [FEW, FIXED],
  "src/core/orders/physical-admin.ts": [FEW, FEW],
  "src/core/receipts/verify.server.ts": [FEW, FEW],
  "src/core/retention/retention.ts": Array<string>(10).fill(
    "scope — не больше IN_CHUNK клиентов: runRetention режет список на куски",
  ),
  "src/core/reviews/admin.ts": [`${PAGE} (отзывы на экране)`, `${PAGE} (отзывы на экране)`],
  "src/core/reviews/photos.server.ts": [`${PAGE} (отзывы на экране)`],
  "src/core/reviews/reviews.ts": [`${PAGE} (≤ 20 отзывов)`],
  "src/core/settings/settings.ts": [FIXED, FIXED],
  "src/core/similar/similar.ts": [
    "покупатели одной пачки SCAN = 200",
    "покупатели одной пачки SCAN = 200",
    "заказы одного покупателя — единицы",
  ],
  "src/core/upsell/upsell.ts": ["товары корзины и правил: корзина + 20"],
  "src/core/vip/auto-check.ts": [FEW],
  "src/core/vip/vip.ts": [FEW, FEW],
};

describe("длинные .in кусками (Б29)", () => {
  const files = execSync("git ls-files 'src/*.ts' 'src/*.tsx'", { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((f) => f && !/\.test\.tsx?$/.test(f));

  it("в src/ `.in(` со списком неизвестной длины — через inChunks или с причиной", () => {
    const report: string[] = [];
    for (const f of files) {
      const found = unboundedIn(readFileSync(f, "utf8"));
      const expected = ALLOWED[f]?.length ?? 0;
      if (found.length !== expected)
        report.push(
          `${f}: найдено ${found.length} (${found.join(" | ")}), в белом списке ${expected}`,
        );
    }
    expect(
      report,
      "читайте кусками inChunks(…, (chunk) => … .in(…, chunk)) или впишите причину",
    ).toEqual([]);
  });

  it("в белом списке нет несуществующих файлов", () => {
    expect(Object.keys(ALLOWED).filter((f) => !files.includes(f))).toEqual([]);
  });

  it("находит переменную и пропускает литерал, константу и chunk", () => {
    const src = [
      'q.in("id", ids)',
      'q.in("s", ["a", "b"])',
      'q.in("s", [...DONE_STATUSES])',
      'q.in("s", PAID)',
      'q.in("id", chunk)',
      'q.in("id", rows.map((r) => r.id))',
    ].join("\n");
    expect(unboundedIn(src)).toEqual(["ids", "rows.map((r) => r.id)"]);
  });
});

describe("inChunks", () => {
  const read = (seen: number[][]) => async (chunk: number[]) => {
    seen.push(chunk);
    return { data: chunk.map((n) => ({ n })), error: null };
  };
  const ids = (n: number) => Array.from({ length: n }, (_, i) => i);

  it.each([
    [0, 0],
    [IN_CHUNK, 1],
    [IN_CHUNK + 1, 2],
    [1000, 5],
  ])("%i id — %i запросов, ни один id не потерян", async (n, calls) => {
    const seen: number[][] = [];
    const rows = await inChunks(ids(n), read(seen), "t");
    expect(seen).toHaveLength(calls);
    expect(seen.every((c) => c.length <= IN_CHUNK)).toBe(true);
    expect(rows).toHaveLength(n);
  });

  it("повторы убираются, ошибка куска — serverFailure, а не «пусто»", async () => {
    const seen: number[][] = [];
    expect(await inChunks([1, 1, 2], read(seen), "t")).toHaveLength(2);
    await expect(
      inChunks([1], async () => ({ data: null, error: { message: "boom" } }), "читаем"),
    ).rejects.toMatchObject({ name: "ServerFailure", message: "читаем: boom" });
    expect(chunksOf(ids(5), 2)).toEqual([[0, 1], [2, 3], [4]]);
  });
});
