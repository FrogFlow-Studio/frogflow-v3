import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Замок от возврата: чтение из базы без `error` превращает сбой в «данных нет»
 * (нет товара, нет настройки, пусто в очереди) — см. `docs/inherited-knowledge.md`
 * и раздел «Ошибки базы» в CLAUDE.md. Тест ищет `const { data } = await …from(…)`
 * (и `count`) без `error` в разборе. Осознанные места — в белом списке с причиной;
 * число мест в файле проверяется, поэтому устаревшая запись тоже краснеет.
 */
export function findUncheckedReads(source: string): number[] {
  const lines: number[] = [];
  const re = /(?:const|let)\s*\{([^}]*)\}\s*=\s*await\s+((?:[^;]|\n)*?)\.from\(/g;
  for (const m of source.matchAll(re)) {
    const [, pattern, chain] = m;
    if (!/\b(?:data|count)\b/.test(pattern!) || /\berror\b/.test(pattern!)) continue;
    // Слишком длинный «хвост» до .from( — это уже другое выражение.
    if (chain!.length >= 120) continue;
    // Хранилище файлов — не таблица: у него своя обработка.
    if (/\.storage\b/.test(chain!)) continue;
    lines.push(source.slice(0, m.index).split("\n").length);
  }
  return lines;
}

/** Файл → сколько мест оставлено осознанно и почему. */
const ALLOWED: Record<string, { n: number; why: string }> = {
  "src/app/auth/tg-login.server.ts": {
    n: 1,
    why: "одноразовый токен входа: сбой = «токен не найден», вход отказан, ничего не открывается",
  },
  "src/core/billing/invoice-check.server.ts": {
    n: 1,
    why: "получатель платежей: пусто = только ручная проверка чека (безопасная сторона)",
  },
  "src/core/broadcasts/broadcasts.ts": {
    n: 1,
    why: "итог отправки (settle): сбой = строка остаётся захваченной, через CLAIM_STALE_MS закрывается как failed без повтора и в счётчики не попадает",
  },
  "src/core/consultant/engine.server.ts": {
    n: 1,
    why: "каталог для подсказки консультанта: без него ответ без цен, сверка цен (price-check) не пропускает выдуманные",
  },
  "src/core/crm/webhook.ts": {
    n: 1,
    why: "вебхук CRM — best effort: сбой чтения заказа = вебхук не уходит, заказ не страдает",
  },
  "src/core/push/admin-push.ts": {
    n: 1,
    why: "подписки push: сбой = уведомление не ушло, сам заказ не страдает (файл А18)",
  },
  "src/core/reminders/cart.ts": {
    n: 1,
    why: "покупатель для напоминания: сбой = пропуск, следующий запуск крона повторит",
  },
  "src/core/reminders/fulfillment.ts": {
    n: 2,
    why: "захват напоминания: сбой = не захвачено, не отправлено, повтор в следующем запуске; язык покупателя — по умолчанию",
  },
  "src/core/settings/settings.ts": {
    n: 2,
    why: "мягкое чтение getSetting/getSettings: только для текстов и необязательного; деньги читают Strict",
  },
  "src/core/waitlist/waitlist.ts": {
    n: 1,
    why: "счётчик «сколько ждут» для показа; не влияет на деньги и выдачу",
  },
};

function sourceFiles(): string[] {
  return execSync("git ls-files 'src/*.ts' 'src/*.tsx'", { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((f) => f && !/\.test\.tsx?$/.test(f));
}

describe("чтение из базы без проверки error", () => {
  it("находит чтение без error и пропускает проверенное и хранилище", () => {
    expect(
      findUncheckedReads('const { data } = await ctx.db\n  .from("x")\n  .select("a");'),
    ).toEqual([1]);
    expect(findUncheckedReads('const { count } = await ctx.db.from("x").select("a");')).toEqual([
      1,
    ]);
    expect(
      findUncheckedReads('const { data, error } = await ctx.db.from("x").select("a");'),
    ).toEqual([]);
    expect(
      findUncheckedReads(
        'const { data } = await serviceDb().storage.from("b").createSignedUrl(k, 1);',
      ),
    ).toEqual([]);
  });

  it("в src/ таких мест нет, кроме белого списка", () => {
    const found: Record<string, number[]> = {};
    for (const f of sourceFiles()) {
      const lines = findUncheckedReads(readFileSync(f, "utf8"));
      if (lines.length) found[f] = lines;
    }
    const unexpected = Object.entries(found)
      .filter(([f, lines]) => lines.length !== (ALLOWED[f]?.n ?? 0))
      .map(([f, lines]) => `${f}:${lines.join(",")}`);
    const stale = Object.keys(ALLOWED).filter((f) => !found[f]);
    expect({ unexpected, stale }).toEqual({ unexpected: [], stale: [] });
  });

  it("у каждого места в белом списке есть причина", () => {
    for (const [f, { why }] of Object.entries(ALLOWED)) expect(why.length, f).toBeGreaterThan(20);
  });
});
