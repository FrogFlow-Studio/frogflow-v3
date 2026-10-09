import { describe, expect, it, vi } from "vitest";
import type { ZernioTransport } from "./api.server";

const ttls: number[] = [];
// Настоящая подписанная ссылка хранилища — с токеном на сотни знаков.
let tokenPad = "";
vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (key: string, ttl: number) => {
          ttls.push(ttl);
          return {
            data: { signedUrl: `https://s.test/${bucket}/${key}${tokenPad}` },
            error: null,
          };
        },
      }),
    },
  }),
}));

const { zernioMaterialSender, downloadButtons } = await import("./deliver");

const BOT = "11111111-1111-1111-1111-111111111111";

function transport() {
  const texts: string[] = [];
  const t = {
    send: vi.fn(async (_conv: string, _acc: string, text: string) => {
      texts.push(text);
      return { ok: true };
    }),
  } as unknown as ZernioTransport;
  return { t, texts };
}

const item = { name_snapshot: "Прописи" } as Parameters<ReturnType<typeof zernioMaterialSender>>[0];

describe("выдача материалов в Direct/WhatsApp", () => {
  it("срок жизни ссылок берётся из кода, а не из текста продавца", async () => {
    ttls.length = 0;
    const { t, texts } = transport();
    const send = zernioMaterialSender(t, "conv-1", "acc-1", "instagram");
    const r = await send(item, [{ path: `${BOT}/propisi.pdf`, name: "Прописи.pdf", url: null }]);
    expect(r).toBe("sent");
    // Срок в тексте совпадает с настоящим сроком подписанной ссылки.
    expect(ttls).toEqual([7 * 24 * 3600]);
    expect(texts[0]).toContain("https://s.test/product-files/");
    expect(texts[0]).toContain("действуют 7 дней");
  });

  it("внешняя ссылка уходит как есть, без приписки о сроке", async () => {
    ttls.length = 0;
    const { t, texts } = transport();
    const send = zernioMaterialSender(t, "conv-1", "acc-1", "instagram");
    await send(item, [{ path: null, name: null, url: "https://drive.test/f" }]);
    expect(ttls).toEqual([]);
    expect(texts[0]).toContain("https://drive.test/f");
    expect(texts[0]).not.toContain("7 дней");
  });

  it("Instagram: ссылки отдельно, «Скачать» вторым сообщением; кнопки не дошли — файл всё равно выдан (заказ #10)", async () => {
    const calls: Array<{ text: string; buttons?: unknown }> = [];
    let n = 0;
    const t = {
      send: vi.fn(async (_c: string, _a: string, text: string, o: { buttons?: unknown }) => {
        calls.push({ text, buttons: o.buttons });
        return n++ === 0 ? { ok: true } : { ok: false, error: "text too long for template" };
      }),
    } as unknown as ZernioTransport;
    const send = zernioMaterialSender(t, "conv-1", "acc-1", "instagram");
    const r = await send({ ...item, id: "item-10" } as typeof item, [
      { path: `${BOT}/glagol.pdf`, name: null, url: null },
    ]);
    expect(r).toBe("sent");
    expect(calls[0]!.buttons).toBeUndefined();
    expect(calls[0]!.text).toContain("https://s.test/product-files/");
    expect(calls[1]!.text).not.toContain("https://");
    expect(calls[1]!.buttons).toEqual([
      expect.objectContaining({ type: "url", title: "📥 Скачать" }),
    ]);
  });

  it("два PDF с длинными ссылками (заказ #20 Копилки): сообщения ≤1000 знаков, все ссылки дошли", async () => {
    const calls: Array<{ text: string; scope?: string; buttons?: unknown }> = [];
    const t = {
      send: vi.fn(
        async (
          _c: string,
          _a: string,
          text: string,
          o: { idempotencyScope?: string; buttons?: unknown },
        ) => {
          calls.push({ text, scope: o.idempotencyScope, buttons: o.buttons });
          // Как Instagram: длиннее 1000 знаков — отказ.
          return text.length > 1000 ? { ok: false, error: "message too long" } : { ok: true };
        },
      ),
    } as unknown as ZernioTransport;
    const send = zernioMaterialSender(t, "conv-1", "acc-1", "instagram", {
      pageUrl: "https://app.test/s/kopilka/order/4063?t=" + "a".repeat(64),
    });
    const long = "palitra";
    tokenPad = `?token=${"t".repeat(380)}`;
    const r = await send(
      { name_snapshot: "Палитра средств выразительности", id: "it-20" } as typeof item,
      [
        { path: `${BOT}/${long}1.pdf`, name: "Тропы а4.pdf", url: null },
        { path: `${BOT}/${long}2.pdf`, name: "Тропы формат А3.pdf", url: null },
      ],
    );
    expect(r).toBe("sent");
    const texts = calls.filter((c) => !c.buttons).map((c) => c.text);
    expect(texts.length).toBeGreaterThan(1);
    for (const x of texts) expect(x.length).toBeLessThanOrEqual(1000);
    const all = texts.join("\n");
    expect(all).toContain(`${long}1.pdf`);
    expect(all).toContain(`${long}2.pdf`);
    expect(all).toContain("действуют 7 дней");
    expect(all).toContain("https://app.test/s/kopilka/order/4063");
    expect(new Set(calls.map((c) => c.scope)).size).toBe(calls.length);
    expect(calls.at(-1)!.buttons).toHaveLength(2);
    tokenPad = "";
  });

  it("ключ идемпотентности — по позиции заказа", async () => {
    const { t } = transport();
    const send = zernioMaterialSender(t, "conv-1", "acc-1", "whatsapp");
    await send({ ...item, id: "item-7" } as typeof item, [
      { path: null, name: "Урок", url: "https://ex.test/l" },
    ]);
    expect(t.send).toHaveBeenCalledWith("conv-1", "acc-1", expect.any(String), {
      platform: "whatsapp",
      idempotencyScope: "deliver:item-7",
    });
  });

  it("в каждом сообщении о выдаче — ссылка на страницу заказа", async () => {
    const { t, texts } = transport();
    const send = zernioMaterialSender(t, "conv-1", "acc-1", "instagram", {
      pageUrl: "https://app.test/s/shop/order/9?t=abc",
    });
    await send(item, [{ path: null, name: "Урок", url: "https://ex.test/l" }]);
    expect(texts[0]).toContain(
      "Все файлы заказа — на странице: https://app.test/s/shop/order/9?t=abc",
    );
  });

  function closed(platformCode: number, platformSubcode?: number) {
    return {
      send: vi.fn(async () => ({
        ok: false,
        error: "outside window",
        failure: { status: 400, platformCode, platformSubcode },
      })),
    } as unknown as ZernioTransport;
  }

  it("окно 24 часа закрыто: файлы ждут на странице — позиция выдана, запасной путь один раз", async () => {
    for (const [code, sub] of [
      [131047, undefined],
      [10, 2018278],
    ] as const) {
      const onWindowClosed = vi.fn(async () => {});
      const send = zernioMaterialSender(closed(code, sub), "c", "a", "whatsapp", {
        pageUrl: "https://app.test/s/shop/order/9?t=abc",
        onWindowClosed,
      });
      const mats = [{ path: null, name: "Урок", url: "https://ex.test/l" }];
      expect(await send(item, mats)).toBe("sent");
      expect(await send({ ...item, id: "i2" } as typeof item, mats)).toBe("sent");
      expect(onWindowClosed).toHaveBeenCalledTimes(1);
    }
  });

  it("окно закрыто, а страницы заказа нет, или другой отказ — не выдано", async () => {
    const mats = [{ path: null, name: "Урок", url: "https://ex.test/l" }];
    expect(await zernioMaterialSender(closed(131047), "c", "a", "whatsapp")(item, mats)).toBe(
      "failed",
    );
    const other = zernioMaterialSender(closed(131026), "c", "a", "whatsapp", {
      pageUrl: "https://app.test/p",
    });
    expect(await other(item, mats)).toBe("failed");
  });
});

describe("язык выдачи в Direct/WhatsApp", () => {
  it("на узбекском нет русских строк", async () => {
    const { t, texts } = transport();
    const send = zernioMaterialSender(t, "c", "a", "whatsapp", {
      pageUrl: "https://app.test/o/1",
      locale: "uz",
    });
    await send({ name_snapshot: "Yozuv" } as typeof item, [
      { path: "p/f.pdf", name: "Dars", url: null },
    ]);
    expect(texts[0]).toContain("Fayl havolalari 7 kun amal qiladi.");
    expect(texts[0]).toContain("Buyurtmaning barcha fayllari — sahifada: https://app.test/o/1");
    expect(texts[0]).not.toMatch(/[а-яё]/i);
  });
});

describe("downloadButtons — «Скачать» прямо в Direct", () => {
  const link = (name: string | null, url = "https://f/1") => ({ name, url });
  it("Instagram, один файл — кнопка «📥 Скачать»", () => {
    expect(downloadButtons("instagram", [link(null)], "📥 Скачать")).toEqual([
      { type: "url", title: "📥 Скачать", url: "https://f/1" },
    ]);
  });
  it("несколько файлов — по кнопке на файл, больше трёх — только ссылки текстом", () => {
    expect(
      downloadButtons("instagram", [link("A"), link(null, "https://f/2")], "x")?.map(
        (b) => b.title,
      ),
    ).toEqual(["📥 A", "📥 2"]);
    expect(downloadButtons("instagram", [link("1"), link("2"), link("3"), link("4")], "x")).toBe(
      undefined,
    );
  });
  it("WhatsApp — без кнопок", () => {
    expect(downloadButtons("whatsapp", [link(null)], "x")).toBeUndefined();
  });
});
