import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ORDER_PAGE_HEADERS } from "./order-page-headers";

/**
 * Страница заказа по ссылке (З5): ссылка с подписью — единственный ключ к заказу, поэтому она не
 * уходит в поиск, в Referer при переходе на оплату и в кэш, а в запросах к серверу идёт только в
 * теле POST (адрес запроса попадает в журналы). Ответы на неверную и чужую ссылку одинаковые —
 * это проверяет src/app/public-access.test.ts; вид заказа без контактов — core/storefront/web-order.test.ts.
 */
const ROUTE = readFileSync("src/routes/s.$slug.order.$id.tsx", "utf8");

describe("страница заказа по ссылке: заголовки", () => {
  it("noindex, no-referrer и без кэша — и в заголовках ответа, и в метках страницы", () => {
    expect(ORDER_PAGE_HEADERS).toMatchObject({
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    });
    expect(ROUTE).toMatch(/headers:\s*\(\)\s*=>\s*ORDER_PAGE_HEADERS/);
    expect(ROUTE).toMatch(/name:\s*"robots",\s*content:\s*"noindex,nofollow"/);
    expect(ROUTE).toMatch(/name:\s*"referrer",\s*content:\s*"no-referrer"/);
  });

  it("ссылки наружу со страницы не открываются с передачей адреса", () => {
    // Все внешние переходы — через window.location.assign на адрес оплаты: Referer снимает заголовок.
    expect(ROUTE).not.toMatch(/referrerPolicy=\{?["']unsafe-url/);
    expect(ROUTE).not.toMatch(/rel="opener"/);
  });
});

describe("ссылка заказа не попадает в адрес запроса и в журналы", () => {
  const dir = join(process.cwd(), "src/app/storefront");
  const files = readdirSync(dir).filter((f) => f.endsWith(".functions.ts"));

  it("функции с подписью заказа (поле t) — только POST", () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(dir, f), "utf8");
      for (const m of src.matchAll(
        /export const (\w+) = createServerFn\(\{\s*method:\s*"(\w+)"\s*\}\)([\s\S]*?)\.handler\(/g,
      ))
        if (m[2] === "GET" && /\b(orderRef|t:\s*z\.string)/.test(m[3]!)) bad.push(`${f}:${m[1]}`);
    }
    expect(bad).toEqual([]);
  });

  it("подпись заказа не пишется в console и в журналы событий", () => {
    for (const f of [...files, "order-token.ts"]) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, f).not.toMatch(/console\.\w+\([^)]*(data\.t\b|\btoken\b|orderAccessToken)/);
      expect(src, f).not.toMatch(/logEvent\([^)]*(data\.t\b|orderAccessToken)/);
    }
  });
});
