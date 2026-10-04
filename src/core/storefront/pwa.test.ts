import { describe, expect, it } from "vitest";
import {
  INSTALL_SNOOZE_DAYS,
  countVisit,
  offlineHtml,
  offlinePath,
  parseInstallMemory,
  shouldOfferInstall,
  swPath,
  swSource,
} from "./pwa";

const DAY = 86_400_000;

describe("service worker витрины", () => {
  const sw = swSource("lavka", "7");

  it("кеширует только страницу «нет сети»: цен и каталога в кеше нет", () => {
    expect([...sw.matchAll(/c\.add\(/g)]).toHaveLength(1);
    expect(sw).toContain(JSON.stringify(offlinePath("lavka")));
    expect(sw).not.toContain("cache.put");
    expect(sw).not.toContain("c.put");
    expect(sw).not.toContain("addAll");
    // Работает только на открытие страницы; картинки и данные идут мимо.
    expect(sw).toContain('e.request.mode !== "navigate"');
  });

  it("страницы соседнего магазина с похожим адресом пропускает", () => {
    expect(sw).toContain('const BASE = "/s/lavka"');
    expect(sw).toContain('path !== BASE && !path.startsWith(BASE + "/")');
  });

  /** Запускает текст service worker с подставными self/fetch/caches и возвращает обработчик fetch. */
  function run(fetchImpl: () => Promise<unknown>) {
    const handlers: Record<string, (e: unknown) => void> = {};
    const cached = { body: "offline-page" };
    const caches = {
      match: async (url: string) => (url === offlinePath("lavka") ? cached : undefined),
      open: async () => ({ add: async () => {} }),
      keys: async () => [],
      delete: async () => true,
    };
    const self = {
      addEventListener: (n: string, h: (e: unknown) => void) => (handlers[n] = h),
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    };
    new Function("self", "caches", "fetch", "Request", "Response", "URL", swSource("lavka", "7"))(
      self,
      caches,
      fetchImpl,
      class {},
      { error: () => "network-error" },
      URL,
    );
    return async (url: string, mode = "navigate") => {
      let out: unknown;
      handlers.fetch?.({ request: { mode, url }, respondWith: (p: Promise<unknown>) => (out = p) });
      return out === undefined ? "skipped" : await (out as Promise<unknown>);
    };
  }

  it("без сети открытие витрины отдаёт сохранённую страницу «нет сети»", async () => {
    const down = run(() => Promise.reject(new TypeError("offline")));
    expect(await down("https://x.test/s/lavka")).toEqual({ body: "offline-page" });
    expect(await down("https://x.test/s/lavka/cart")).toEqual({ body: "offline-page" });
  });

  it("с сетью страница приходит из сети; картинки и чужие адреса идут мимо", async () => {
    const up = run(() => Promise.resolve("live-page"));
    expect(await up("https://x.test/s/lavka")).toBe("live-page");
    expect(await up("https://x.test/api/img/1", "no-cors")).toBe("skipped");
    expect(await up("https://x.test/s/lavka2")).toBe("skipped");
  });

  it("версия входит в имя кеша, старые кеши этого магазина удаляются при активации", () => {
    expect(sw).toContain('const CACHE = PREFIX + "7"');
    expect(sw).toContain("k !== CACHE");
    expect(swSource("lavka", "8")).toContain('PREFIX + "8"');
  });

  it("адреса привязаны к магазину; чужой slug в текст не попадёт", () => {
    expect(swPath("lavka")).toBe("/s/lavka/sw.js");
    expect(() => swSource('x";alert(1);"')).toThrow();
    expect(() => swSource("")).toThrow();
  });
});

describe("страница «нет сети»", () => {
  const html = offlineHtml({
    lang: "ru",
    name: 'Лавка <script>alert(1)</script> "A"',
    title: "Нет сети",
    text: "Проверьте подключение и повторите.",
    retry: "Повторить",
    accent: "#ff0066",
  });

  it("название и тексты экранируются, цвет только в формате #rrggbb", () => {
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("background:#ff0066");
    expect(
      offlineHtml({ lang: "ru", name: "A", title: "t", text: "t", retry: "r", accent: "red;}x{" }),
    ).toContain("background:#2563eb");
  });

  it("не просится в поиск и не содержит цен", () => {
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toMatch(/₸|price/i);
  });
});

describe("«Добавить на главный экран»", () => {
  it("первый визит — не предлагаем, второй — предлагаем", () => {
    let m = parseInstallMemory(null);
    expect(shouldOfferInstall(countVisit(m), false, 0)).toBe(false);
    m = countVisit(countVisit(m));
    expect(shouldOfferInstall(m, false, 0)).toBe(true);
  });

  it("уже установленному приложению не предлагаем", () => {
    expect(shouldOfferInstall({ visits: 5, dismissedAt: null }, true, 0)).toBe(false);
  });

  it("после «Не сейчас» молчим 30 дней", () => {
    const m = { visits: 5, dismissedAt: 1000 };
    expect(shouldOfferInstall(m, false, 1000 + (INSTALL_SNOOZE_DAYS - 1) * DAY)).toBe(false);
    expect(shouldOfferInstall(m, false, 1000 + INSTALL_SNOOZE_DAYS * DAY)).toBe(true);
  });

  it("битая запись в браузере не ломает: это первый визит", () => {
    expect(parseInstallMemory("{")).toEqual({ visits: 0, dismissedAt: null });
    expect(parseInstallMemory('{"visits":"много"}')).toEqual({ visits: 0, dismissedAt: null });
    expect(parseInstallMemory('{"visits":3,"dismissedAt":5}')).toEqual({
      visits: 3,
      dismissedAt: 5,
    });
  });
});
