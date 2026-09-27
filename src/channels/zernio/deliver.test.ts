import { describe, expect, it, vi } from "vitest";
import type { ZernioTransport } from "./api.server";

const ttls: number[] = [];
vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (key: string, ttl: number) => {
          ttls.push(ttl);
          return { data: { signedUrl: `https://s.test/${bucket}/${key}` }, error: null };
        },
      }),
    },
  }),
}));

const { zernioMaterialSender } = await import("./deliver");

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
});
