import { readdirSync, readFileSync } from "node:fs";
import { toCrossJSONAsync, fromCrossJSON } from "seroval";
import { makeSerovalPlugin } from "@tanstack/router-core";
import { defaultSerovalPlugins } from "@tanstack/router-core/ssr/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserError } from "@/core/i18n/user-error";
import { ADMIN_DICTS } from "@/app/i18n/admin";
import {
  handleClientError,
  MAX_PER_IP_PER_MINUTE,
  MAX_PER_MINUTE,
  pageArea,
  parseClientReport,
  resetClientErrorLimit,
} from "./client-error.server";
import {
  BAD_INPUT_TEXT,
  isPlatformFailure,
  SERVER_FAILED_TEXT,
  toScreenError,
} from "./server-fn-errors";
import {
  claimStaleReload,
  clientErrorReport,
  isBrowserFailure,
  isStaleChunkError,
  screenErrorText,
  shownError,
  shownErrorAdapter,
} from "./shown-error";

const ru = (e: UserError) => Promise.resolve(e.message);

describe("текст ошибки на экране", () => {
  it("сбой в коде страницы — понятная фраза, а не текст исключения", () => {
    let crash: unknown;
    try {
      const r = undefined as unknown as { ok: boolean };
      void r.ok;
    } catch (e) {
      crash = e;
    }
    expect(String((crash as Error).message)).toContain("reading 'ok'");
    expect(screenErrorText(crash)).toBe("Не удалось связаться с сервером. Попробуйте ещё раз.");
    expect(isBrowserFailure(crash)).toBe(true);
  });

  it("страница 500 вместо ответа и обрыв сети — тоже понятная фраза", () => {
    const html = new Error("<!DOCTYPE html><html>A server error has occurred</html>");
    expect(screenErrorText(html)).not.toContain("<");
    expect(screenErrorText(new TypeError("Failed to fetch"), "en")).toBe(
      "Could not reach the server. Please try again.",
    );
    expect(screenErrorText("строка", "kk")).toContain("Сервермен");
  });

  it("помеченный текст показывается как есть; конец сессии и отмена не репортятся", () => {
    expect(screenErrorText(shownError("Неверный код"))).toBe("Неверный код");
    const session = new Error("Unauthorized");
    expect(screenErrorText(session, "ru")).toContain("Сессия закончилась");
    expect(isBrowserFailure(session)).toBe(false);
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(isBrowserFailure(abort)).toBe(false);
    expect(isBrowserFailure(shownError("x"))).toBe(false);
  });

  it("пометка переживает передачу из серверной функции в браузер", async () => {
    // Те же плагины, что у TanStack Start: стандартный для Error отдаёт только
    // message, поэтому без своего типа (start.ts) пометка терялась.
    const transfer = async (e: unknown, adapters: (typeof shownErrorAdapter)[]) => {
      const plugins = [...adapters.map((a) => makeSerovalPlugin(a)), ...defaultSerovalPlugins];
      return fromCrossJSON(await toCrossJSONAsync(e, { refs: new Map(), plugins }), {
        refs: new Map(),
        plugins,
      });
    };
    expect(screenErrorText(await transfer(shownError("Заказ закрыт"), []))).toBe(
      "Не удалось связаться с сервером. Попробуйте ещё раз.",
    );
    const back = await transfer(shownError("Заказ закрыт"), [shownErrorAdapter]);
    expect(screenErrorText(back)).toBe("Заказ закрыт");
    // Сбой по-прежнему идёт обычной ошибкой и остаётся сбоем.
    expect(isBrowserFailure(await transfer(new Error("boom"), [shownErrorAdapter]))).toBe(true);
  });
});

describe("toScreenError: что серверная функция отдаёт в браузер", () => {
  it("UserError — переведённым и помеченным", async () => {
    const out = await toScreenError(new UserError("err.x", "Текст"), async () => "Text");
    expect(screenErrorText(out)).toBe("Text");
  });

  it("сбой — фраза «сбой на сервере» вместо сырого текста", async () => {
    for (const e of [
      new TypeError("Cannot read properties of undefined"),
      new Error("duplicate key"),
    ]) {
      const out = await toScreenError(e, ru);
      expect(screenErrorText(out)).toBe(SERVER_FAILED_TEXT);
    }
  });

  it("русский отказ панели — как есть, ввод — «проверьте поля»", async () => {
    expect(screenErrorText(await toScreenError(new Error("Пароли не совпадают."), ru))).toBe(
      "Пароли не совпадают.",
    );
    const zod = Object.assign(new Error('[{"code":"too_big"}]'), { name: "ZodError" });
    expect(screenErrorText(await toScreenError(zod, ru))).toBe(BAD_INPUT_TEXT);
  });

  it("отказ на языке магазина (en/uz, без кириллицы) — как есть, не «сбой»", async () => {
    for (const text of [
      "Too many failed attempts. Try again in 15 minutes.",
      "Mahsulot topilmadi",
    ]) {
      const e = shownError(text);
      expect(isPlatformFailure(e)).toBe(false);
      expect(screenErrorText(await toScreenError(e, ru))).toBe(text);
    }
  });

  it("переведённые отказы входа и витрины бросаются помеченными", () => {
    // Текст из словаря (tr/t/shopT) без пометки ушёл бы как «сбой на сервере»
    // у магазинов на английском и узбекском.
    const unmarked = /throw new Error\(\s*(?:tr\(|t\(|\(await shopT)/;
    const admin = readdirSync("src/app/admin")
      .filter((f) => f.endsWith(".functions.ts"))
      .map((f) => `src/app/admin/${f}`);
    for (const f of [...admin, "src/app/storefront/storefront.functions.ts"])
      expect(readFileSync(f, "utf8"), f).not.toMatch(unmarked);
  });

  it("redirect, Response и конец сессии идут как были", async () => {
    const redirect = { isRedirect: true };
    expect(await toScreenError(redirect, ru)).toBe(redirect);
    const res = new Response(null, { status: 302 });
    expect(await toScreenError(res, ru)).toBe(res);
    class Unauthorized extends Error {
      constructor() {
        super("Unauthorized");
      }
    }
    const u = new Unauthorized();
    expect(await toScreenError(u, ru)).toBe(u);
  });

  it("русский текст фраз совпадает со словарём админки", () => {
    const d = ADMIN_DICTS.ru as Record<string, string>;
    expect(d["err.server.failed"]).toBe(SERVER_FAILED_TEXT);
    expect(d["err.server.badInput"]).toBe(BAD_INPUT_TEXT);
  });
});

describe("/api/client-error", () => {
  afterEach(() => resetClientErrorLimit());

  const req = (body: unknown, origin: string | null = "https://www.frogflow.tech") =>
    new Request("https://www.frogflow.tech/api/client-error", {
      method: "POST",
      headers: origin ? { origin, "content-type": "application/json" } : {},
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  it("отчёт браузера уходит в учёт с разделом и адресом страницы", async () => {
    const report = vi.fn(async () => {});
    const crash = new TypeError("Cannot read properties of undefined (reading 'ok')");
    const res = await handleClientError(req(clientErrorReport(crash, "/operator/login")), {
      report,
    });
    expect(res.status).toBe(204);
    expect(report).toHaveBeenCalledOnce();
    const [err, c] = report.mock.calls[0]! as unknown as [Error, { where: string; extra: object }];
    expect(err.name).toBe("TypeError");
    expect(err.message).toContain("reading 'ok'");
    expect(c.where).toBe("browser:operator");
    expect(c.extra).toEqual({ path: "/operator/login" });
  });

  it("чужой сайт, кривое и большое тело — отказ без отчёта", async () => {
    const report = vi.fn(async () => {});
    const ok = { name: "Error", message: "x", path: "/admin" };
    expect((await handleClientError(req(ok, "https://evil.example"), { report })).status).toBe(403);
    expect((await handleClientError(req(ok, null), { report })).status).toBe(403);
    expect((await handleClientError(req("{"), { report })).status).toBe(400);
    expect((await handleClientError(req({ ...ok, path: "https://x" }), { report })).status).toBe(
      400,
    );
    expect((await handleClientError(req("x".repeat(9000)), { report })).status).toBe(413);
    expect(report).not.toHaveBeenCalled();
  });

  it("не больше лимита отчётов в минуту", async () => {
    const report = vi.fn(async () => {});
    const ok = { name: "Error", message: "x", path: "/s/shop" };
    let t = 1_000_000;
    for (let i = 0; i < MAX_PER_MINUTE + 5; i++)
      await handleClientError(req(ok), { report, now: () => t });
    expect(report).toHaveBeenCalledTimes(MAX_PER_MINUTE);
    t += 60_000;
    await handleClientError(req(ok), { report, now: () => t });
    expect(report).toHaveBeenCalledTimes(MAX_PER_MINUTE + 1);
  });

  it("запрос с чужой страницы по Sec-Fetch-Site — отказ, даже с подделанным Origin", async () => {
    const report = vi.fn(async () => {});
    const ok = { name: "Error", message: "x", path: "/admin" };
    const forged = (site: string) =>
      new Request("https://www.frogflow.tech/api/client-error", {
        method: "POST",
        headers: { origin: "https://www.frogflow.tech", "sec-fetch-site": site },
        body: JSON.stringify(ok),
      });
    expect((await handleClientError(forged("cross-site"), { report })).status).toBe(403);
    expect((await handleClientError(forged("none"), { report })).status).toBe(403);
    expect((await handleClientError(forged("same-origin"), { report })).status).toBe(204);
    expect(report).toHaveBeenCalledOnce();
  });

  it("с одного адреса — не больше своего лимита, другие адреса не страдают", async () => {
    const report = vi.fn(async () => {});
    const ok = { name: "Error", message: "x", path: "/s/shop" };
    const from = (ip: string) =>
      new Request("https://www.frogflow.tech/api/client-error", {
        method: "POST",
        headers: { origin: "https://www.frogflow.tech", "x-forwarded-for": `${ip}, 10.0.0.1` },
        body: JSON.stringify(ok),
      });
    const t = 5_000_000;
    for (let i = 0; i < MAX_PER_IP_PER_MINUTE + 10; i++)
      await handleClientError(from("203.0.113.7"), { report, now: () => t });
    expect(report).toHaveBeenCalledTimes(MAX_PER_IP_PER_MINUTE);
    await handleClientError(from("198.51.100.2"), { report, now: () => t });
    expect(report).toHaveBeenCalledTimes(MAX_PER_IP_PER_MINUTE + 1);
    await handleClientError(from("203.0.113.7"), { report, now: () => t + 60_000 });
    expect(report).toHaveBeenCalledTimes(MAX_PER_IP_PER_MINUTE + 2);
  });

  it("поля обрезаются, раздел по адресу", () => {
    const r = parseClientReport({ name: "E", message: "m".repeat(2000), path: "/admin/x" });
    expect(r!.message).toHaveLength(500);
    expect(pageArea("/s/demo/cart")).toBe("storefront");
    expect(pageArea("/")).toBe("site");
  });
});

describe("старая сборка после выкладки", () => {
  it("узнаёт отказ загрузить кусок в Chrome, Firefox и Safari, остальное — нет", () => {
    for (const m of [
      "Failed to fetch dynamically imported module: https://www.frogflow.tech/assets/admin._authed.instagram-CXMWFVFK.js",
      "error loading dynamically imported module: https://www.frogflow.tech/assets/x.js",
      "Importing a module script failed.",
      "Unable to preload CSS for /assets/admin-1.css",
    ])
      expect(isStaleChunkError(new TypeError(m)), m).toBe(true);
    expect(isStaleChunkError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isStaleChunkError(new Error("Unauthorized"))).toBe(false);
  });

  it("перезагружает не чаще раза в минуту и без хранилища не перезагружает", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const t0 = Date.parse("2026-10-08T21:00:00Z");
    expect(claimStaleReload(storage, t0)).toBe(true);
    expect(claimStaleReload(storage, t0 + 30_000)).toBe(false);
    expect(claimStaleReload(storage, t0 + 60_000)).toBe(true);
    expect(claimStaleReload(null, t0)).toBe(false);
    const broken = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(claimStaleReload(broken, t0)).toBe(false);
  });
});
