import { afterEach, describe, expect, it, vi } from "vitest";
import { setEnvForTests } from "@/config/env";
import {
  DM_BUTTON_TITLE_MAX,
  buttonTitle,
  downloadAttachment,
  normalizeDmButtons,
  listConversationMessages,
  listProfiles,
  readCapped,
} from "./api.server";

afterEach(() => {
  setEnvForTests(undefined);
  vi.unstubAllGlobals();
});

describe("downloadAttachment — чек из вложения Zernio", () => {
  it("медиа WhatsApp: ключ Zernio в заголовке, accountId из ссылки события не дублируется", async () => {
    setEnvForTests({ ZERNIO_API_KEY: "sk_test" });
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const file = await downloadAttachment(
      "https://zernio.com/api/v1/whatsapp/media/media-1?accountId=from-event",
    );
    expect(file?.mime).toBe("image/jpeg");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).searchParams.getAll("accountId")).toEqual(["from-event"]);
    expect(init.headers).toEqual({ Authorization: "Bearer sk_test" });
  });
});

describe("readCapped — вложение не больше лимита", () => {
  const stream = (sizes: number[], pulled: number[]) =>
    new ReadableStream<Uint8Array>({
      pull(c) {
        const n = sizes.shift();
        if (n == null) return c.close();
        pulled.push(n);
        c.enqueue(new Uint8Array(n));
      },
    });

  it("в пределах лимита — всё тело целиком", async () => {
    const bytes = await readCapped(new Response(stream([3, 4], [])), 10);
    expect(bytes?.byteLength).toBe(7);
  });

  it("Content-Length больше лимита — отказ без чтения тела", async () => {
    const pulled: number[] = [];
    const res = new Response(stream([5], pulled), { headers: { "content-length": "999" } });
    expect(await readCapped(res, 10)).toBeNull();
    expect(pulled).toEqual([]);
  });

  it("без Content-Length чтение обрывается, как только тело перевалило за лимит", async () => {
    const pulled: number[] = [];
    const res = new Response(stream([6, 6, 6, 6, 6], pulled));
    expect(await readCapped(res, 10)).toBeNull();
    expect(pulled.length).toBeLessThan(5);
  });

  it("огромный документ из WhatsApp не скачивается", async () => {
    setEnvForTests({ ZERNIO_API_KEY: "sk_test" });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array(1), {
            headers: { "content-length": String(500 * 1024 * 1024) },
          }),
      ),
    );
    expect(await downloadAttachment("https://zernio.com/api/v1/whatsapp/media/big")).toBeNull();
  });
});

describe("адрес API Zernio (опись v1: tests/zernio-base-url.test.ts)", () => {
  it("calls the JSON API even when Vercel contains only the Zernio host", async () => {
    setEnvForTests({ ZERNIO_API_KEY: "sk_test", ZERNIO_BASE_URL: "https://zernio.com" });
    const fetchMock = vi.fn(async () => Response.json({ profiles: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await listProfiles();
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://zernio.com/api/v1/profiles");
  });

  it("reports a useful configuration error for an HTML response", async () => {
    setEnvForTests({ ZERNIO_API_KEY: "sk_test", ZERNIO_BASE_URL: "https://zernio.com/app" });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<!doctype html><html></html>", {
            headers: { "content-type": "text/html" },
          }),
      ),
    );
    await expect(listProfiles()).rejects.toThrow(/Проверьте ZERNIO_BASE_URL/);
  });
});

describe("listConversationMessages — хвост переписки", () => {
  it("просит у Zernio последние сто сообщений (новые первыми) и отдаёт их по времени", async () => {
    setEnvForTests({ ZERNIO_API_KEY: "sk_test" });
    const fetchMock = vi.fn(async () =>
      Response.json({
        messages: [
          { direction: "outgoing", message: "третье", createdAt: "2026-09-01T12:03:00Z" },
          { direction: "incoming", message: "второе", createdAt: "2026-09-01T12:02:00Z" },
          { direction: "incoming", message: "первое", createdAt: "2026-09-01T12:01:00Z" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const tail = await listConversationMessages("acc-1", "conv/1");
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    const u = new URL(url);
    expect(u.pathname.endsWith("/inbox/conversations/conv%2F1/messages")).toBe(true);
    expect(u.searchParams.get("accountId")).toBe("acc-1");
    expect(u.searchParams.get("limit")).toBe("100");
    // Без sortOrder=desc длинный диалог отдавал первые сто — самые старые, без ответа менеджера.
    expect(u.searchParams.get("sortOrder")).toBe("desc");
    expect(tail.map((m) => m.message)).toEqual(["первое", "второе", "третье"]);
  });
});

describe("кнопки Direct/WhatsApp — заголовок не длиннее 20 символов", () => {
  it("длинная кнопка продавца обрезается с «…», короткая и эмодзи не портятся", () => {
    const [long, short, emoji] = normalizeDmButtons([
      { type: "postback", title: "  Получить бесплатный урок сейчас  ", payload: "LESSON" },
      { type: "url", title: "Каталог", url: "https://example.com" },
      { type: "postback", title: "🎁🎁🎁🎁🎁🎁🎁🎁🎁🎁🎁🎁🎁🎁🎁🎁🎁🎁🎁🎁🎁🎁", payload: "G" },
    ]);
    expect(long!.title).toBe("Получить бесплатный…");
    expect(long!.title.length).toBe(DM_BUTTON_TITLE_MAX);
    expect(long!.payload).toBe("LESSON");
    expect(short!.title).toBe("Каталог");
    // 🎁 — две единицы UTF-16: входит девять и «…».
    expect(emoji!.title).toBe(`${"🎁".repeat(9)}…`);
  });

  it("составные эмодзи не рвутся, итог не длиннее 20 единиц UTF-16", () => {
    const family = "👨‍👩‍👧‍👦"; // 11 единиц
    const flag = "🇰🇿"; // 4
    const thumb = "👍🏽"; // 4
    const graphemes = (s: string) =>
      Array.from(
        new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s),
        (x) => x.segment,
      );
    for (const [input, expected] of [
      [`Семья ${family} ура`, `Семья ${family} у…`],
      [`${flag}${flag}${flag}${flag}${flag}${flag}`, `${flag}${flag}${flag}${flag}…`],
      [`Класс ${thumb}${thumb}${thumb}${thumb}`, `Класс ${thumb}${thumb}${thumb}…`],
    ] as const) {
      const title = buttonTitle(input);
      expect(title).toBe(expected);
      expect(title.length).toBeLessThanOrEqual(DM_BUTTON_TITLE_MAX);
      for (const g of graphemes(title.slice(0, -1))) expect(graphemes(input)).toContain(g);
    }
    expect(buttonTitle(`${family}${family}`)).toBe(`${family}…`);
    expect(buttonTitle(`  ${flag} Казахстан  `)).toBe(`${flag} Казахстан`);
  });
});
