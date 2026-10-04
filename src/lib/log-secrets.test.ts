import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../tests/fake-db";
import { auditDetails } from "@/core/audit/admin-audit";
import { scrubForLog, scrubSecretsIn } from "./log-mask";
import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * В журналах (`zernio_logs`, `bot_events`, учёт ошибок и console функций) не должно быть полей
 * `token`, `secret`, `api_key`, `password` и полных ссылок заказа с подписью (З6). Два слоя:
 * скан исходников — ни одно место записи или вывода не называет такое поле и не подставляет
 * такую переменную; и сама запись — журнал событий заказа, журнал оператора, журнал действий
 * админки и вебхук Zernio вычёркивают подпись ссылки и значения секретных полей.
 */
const TOKEN = "a1b2c3d4".repeat(4);
const LINK = `https://shop.test/s/shop/order/9?t=${TOKEN}`;

describe("вычёркивание секретов", () => {
  it("подпись ссылки заказа, токен бота и Bearer вычёркиваются из строки", () => {
    expect(scrubSecretsIn(`Оплатите: ${LINK}`)).toBe(
      "Оплатите: https://shop.test/s/shop/order/9?t=***",
    );
    expect(scrubSecretsIn("a?x=1&t=" + TOKEN + "&y=2")).toBe("a?x=1&t=***&y=2");
    expect(scrubSecretsIn("bot 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw9 упал")).toBe(
      "bot ***:*** упал",
    );
    expect(scrubSecretsIn("Authorization: Bearer abcdef1234567890")).toBe(
      "Authorization: Bearer ***",
    );
    // Обычный текст и короткие t= не трогаем.
    expect(scrubSecretsIn("Заказ №12, t=5 штук, 10:30")).toBe("Заказ №12, t=5 штук, 10:30");
  });

  it("секретные ключи на любой глубине — «***», остальное цело", () => {
    const out = scrubForLog({
      id: 1,
      token: "x",
      nested: { API_KEY: "y", list: [{ password: "p", ok: LINK }] },
      secret: "s",
      apiKey: "k",
      tokens: 3,
    });
    expect(out).toEqual({
      id: 1,
      token: "***",
      nested: {
        API_KEY: "***",
        list: [{ password: "***", ok: "https://shop.test/s/shop/order/9?t=***" }],
      },
      secret: "***",
      apiKey: "***",
      tokens: 3,
    });
  });

  it("keys: false — имена полей чужого тела не трогаем, строки чистим", () => {
    expect(scrubForLog({ token: "t", text: LINK }, { keys: false })).toEqual({
      token: "t",
      text: "https://shop.test/s/shop/order/9?t=***",
    });
  });
});

describe("места записи вычёркивают секреты", () => {
  let db: FakeDb;
  const ctx = () => ({ tenant: { id: "bot", modules: {} }, db }) as unknown as TenantContext;
  beforeEach(() => {
    db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
    db.tables.zernio_logs = [];
  });

  it("события заказа: и обычное, и «один раз» (ссылка в тексте неудавшегося уведомления)", async () => {
    const { recordOrderEvent, claimOrderEvent } = await import("@/core/orders/events");
    await recordOrderEvent(ctx(), 9, "notify_failed", { text: `Оплатить: ${LINK}`, token: "zzz" });
    await claimOrderEvent(ctx(), 9, "notify_failed", "k1", { text: LINK, secret: "s" });
    expect(db.tables.zernio_logs).toHaveLength(2);
    const stored = JSON.stringify(db.tables.zernio_logs);
    expect(stored).not.toContain(TOKEN);
    expect(stored).not.toContain("zzz");
    expect(stored).toContain("order/9?t=***");
  });

  it("журнал оператора (bot_events)", async () => {
    const events: Array<Record<string, unknown>> = [];
    vi.resetModules();
    vi.doMock("@/core/db/client.server", () => ({
      serviceDb: () => ({
        from: () => ({
          insert: async (row: Record<string, unknown>) => {
            events.push(row);
            return { error: null };
          },
        }),
      }),
    }));
    const { logEvent } = await import("@/app/operator/operator.server");
    await logEvent("bot", "meta", { reason: `см. ${LINK}`, api_key: "k-1" });
    vi.doUnmock("@/core/db/client.server");
    expect(JSON.stringify(events)).not.toContain(TOKEN);
    expect(JSON.stringify(events)).not.toContain("k-1");
  });

  it("журнал действий админки: поля с паролем и токеном — «•••», ссылка заказа — без подписи", () => {
    const d = auditDetails({ password: "p", token: "t", api_key: "k", note: `см. ${LINK}` });
    expect(d).toMatchObject({ password: "•••", token: "•••", api_key: "•••" });
    expect(JSON.stringify(d)).not.toContain(TOKEN);
  });
});

/* ───── скан исходников ───── */

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(f) && !/\.test\.|\.gen\./.test(f)) out.push(p);
  }
  return out;
}
function closing(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return i;
  }
  return s.length;
}
const SECRET_NAME =
  /\b(token|secret|api_?key|password|passwd|access_?token|bot_?token|authorization|bearer)\b/i;
const SECRET_FIELD =
  /(?:(?:^|[{,\s])(?:token|secret|api_?key|password|access_?token|authorization)\s*[:,}])|(?:["'](?:token|secret|api_?key|password|access_?token|authorization)["']\s*:)/i;
const LOGGED = /\b(console\.(?:log|error|warn|info|debug)|serverFailure|new Error|reportError)\(/g;
const EVENT_WRITE =
  /\b(?:from\("(?:zernio_logs|bot_events)"\)\s*\.(?:insert|upsert)|logEvent|recordOrderEvent|claimOrderEvent)\(/g;

/** Подстановки `${…}` в вызове вывода — то, что реально уходит в журнал. */
export function loggedSecrets(src: string): string[] {
  const bad: string[] = [];
  for (const m of src.matchAll(LOGGED)) {
    const o = m.index + m[0].length - 1;
    const call = src.slice(o, closing(src, o) + 1);
    const code = [...call.matchAll(/\$\{([^}]*)\}/g)].map((x) => x[1]).join(" ");
    // Не в строках, а в выражениях: переменная token, apiKey, secret…
    if (SECRET_NAME.test(code)) bad.push(call.replace(/\s+/g, " ").slice(0, 120));
  }
  return bad;
}

/** Записи в журналы, в которых поле с секретным именем или ссылка заказа. */
export function eventSecrets(src: string): string[] {
  const bad: string[] = [];
  for (const m of src.matchAll(EVENT_WRITE)) {
    const o = m.index + m[0].length - 1;
    const call = src.slice(o, closing(src, o) + 1);
    if (SECRET_FIELD.test(call) || /orderPageUrl|orderAccessToken|\/order\/\$\{/.test(call))
      bad.push(call.replace(/\s+/g, " ").slice(0, 120));
  }
  return bad;
}

describe("скан исходников: что уходит в журналы и console", () => {
  const files = walk(join(process.cwd(), "src"));

  it("исходники найдены", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("console и тексты ошибок не подставляют token, secret, api_key, password", () => {
    const found = files.flatMap((f) =>
      loggedSecrets(readFileSync(f, "utf8")).map((x) => `${f}: ${x}`),
    );
    expect(found).toEqual([]);
  });

  it("записи в zernio_logs и bot_events не называют поля token, secret, api_key, password и не кладут ссылку заказа", () => {
    const found = files.flatMap((f) =>
      eventSecrets(readFileSync(f, "utf8")).map((x) => `${f}: ${x}`),
    );
    expect(found).toEqual([]);
  });

  it("сам скан ловит нарушения (проверка на заведомо плохом коде)", () => {
    expect(loggedSecrets("console.error(`вызов упал: ${token}`)")).toHaveLength(1);
    expect(loggedSecrets("throw serverFailure(`ключ ${cfg.apiKey}`)")).toHaveLength(1);
    expect(loggedSecrets("console.warn(`заказ #${id}: ${e}`)")).toEqual([]);
    expect(
      eventSecrets('await db.from("zernio_logs").insert({ payload: { token: t } })'),
    ).toHaveLength(1);
    expect(
      eventSecrets("await recordOrderEvent(ctx, 1, 'x', { link: await orderPageUrl(ctx, 1) })"),
    ).toHaveLength(1);
    expect(eventSecrets("await recordOrderEvent(ctx, 1, 'x', { text: 'ok' })")).toEqual([]);
  });
});
