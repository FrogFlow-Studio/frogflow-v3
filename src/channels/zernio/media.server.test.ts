import { afterEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { imageUrl } from "@/core/catalog/catalog";
import { cacheImageInfo, fitsZernio, zernioImageUrl } from "./media.server";

const MB = 1024 * 1024;
const ctx = {
  tenant: { id: "00000000-0000-0000-0000-0000000000aa" },
  appUrl: "https://app.test",
} as unknown as TenantContext;

/** Первые байты настоящих файлов. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ");
const HTML = new TextEncoder().encode("<!doctype html>");

describe("фото для Instagram и WhatsApp", () => {
  it("только JPEG/PNG; Instagram до 8 МБ, WhatsApp до 5 МБ", () => {
    const jpg = (size: number) => ({ size, contentType: "image/jpeg", head: JPEG });
    expect(fitsZernio("instagram", "a.jpg", jpg(8 * MB))).toBe(true);
    expect(fitsZernio("instagram", "a.jpg", jpg(8 * MB + 1))).toBe(false);
    expect(fitsZernio("whatsapp", "a.jpg", jpg(5 * MB))).toBe(true);
    expect(fitsZernio("whatsapp", "a.jpg", jpg(5 * MB + 1))).toBe(false);
    expect(
      fitsZernio("instagram", "a.gif", { size: MB, contentType: "image/gif", head: JPEG }),
    ).toBe(false);
    // Тип из бакета важнее расширения.
    expect(
      fitsZernio("instagram", "a.jpg", { size: MB, contentType: "image/webp", head: JPEG }),
    ).toBe(false);
    // Без типа — по расширению.
    expect(fitsZernio("whatsapp", "a.PNG", { size: MB, contentType: "", head: PNG })).toBe(true);
    expect(fitsZernio("whatsapp", "a.webp", { size: MB, contentType: "", head: PNG })).toBe(false);
  });

  it("решают первые байты: WebP или страница под именем .jpg и типом image/jpeg не проходят", () => {
    const as = (head: Uint8Array) => ({ size: MB, contentType: "image/jpeg", head });
    expect(fitsZernio("instagram", "a.jpg", as(WEBP))).toBe(false);
    expect(fitsZernio("instagram", "a.jpg", as(HTML))).toBe(false);
    expect(fitsZernio("instagram", "a.jpg", as(new Uint8Array()))).toBe(false);
    // PNG под именем .jpg — формат, который канал принимает.
    expect(fitsZernio("instagram", "a.jpg", as(PNG))).toBe(true);
  });

  it("не подошло ни одно из первых трёх — без фото", async () => {
    const seen: string[] = [];
    const url = await zernioImageUrl(
      ctx,
      "whatsapp",
      ["1.gif", null, "2.gif", "3.gif", "4.jpg"],
      async (_c, p) => {
        seen.push(p);
        return {
          size: MB,
          contentType: p.endsWith("jpg") ? "image/jpeg" : "image/gif",
          head: JPEG,
        };
      },
    );
    expect(url).toBeNull();
    expect(seen).toEqual(["1.gif", "2.gif", "3.gif"]);
  });

  it("файла нет или чтение упало — следующее фото", async () => {
    const url = await zernioImageUrl(
      ctx,
      "instagram",
      ["gone.jpg", "err.jpg", "ok.jpg"],
      async (_c, p) => {
        if (p === "err.jpg") throw new Error("storage down");
        return p === "ok.jpg" ? { size: MB, contentType: "image/jpeg", head: JPEG } : null;
      },
    );
    expect(url).toBe(imageUrl(ctx, "ok.jpg"));
  });
});

describe("проверка фото запоминается", () => {
  it("повторный показ не спрашивает хранилище; через 10 минут — снова", async () => {
    let t = 0;
    const read = vi.fn(async () => ({ size: MB, contentType: "image/jpeg", head: JPEG }));
    const cached = cacheImageInfo(read, () => t);
    await cached(ctx, "a.jpg");
    await cached(ctx, "a.jpg");
    await cached(ctx, "b.jpg");
    expect(read).toHaveBeenCalledTimes(2);
    // Другой магазин — свой ключ.
    await cached({ tenant: { id: "other" } } as unknown as TenantContext, "a.jpg");
    expect(read).toHaveBeenCalledTimes(3);
    t = 10 * 60 * 1000;
    await cached(ctx, "a.jpg");
    expect(read).toHaveBeenCalledTimes(4);
  });

  it("ошибку чтения не запоминаем", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("storage down"))
      .mockResolvedValue({ size: MB, contentType: "image/jpeg", head: JPEG });
    const cached = cacheImageInfo(read);
    await expect(cached(ctx, "a.jpg")).rejects.toThrow();
    expect(await cached(ctx, "a.jpg")).toMatchObject({ size: MB });
    expect(await cached(ctx, "a.jpg")).toMatchObject({ size: MB });
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe("чтение из бакета: только первые байты", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("@/core/db/client.server");
    vi.resetModules();
  });

  it("запрос Range за первыми байтами по подписанной ссылке, всё фото не качаем", async () => {
    vi.resetModules();
    const signed: string[] = [];
    vi.doMock("@/core/db/client.server", () => ({
      serviceDb: () => ({
        storage: {
          from: () => ({
            info: async (key: string) =>
              key.startsWith(ctx.tenant.id)
                ? { data: { size: 2 * MB, contentType: "image/jpeg" }, error: null }
                : { data: null, error: {} },
            createSignedUrl: async (key: string) => {
              signed.push(key);
              return { data: { signedUrl: `https://storage.test/${key}` }, error: null };
            },
          }),
        },
      }),
    }));
    const ranges: Array<string | null> = [];
    // Хранилище Range не учло и отдаёт всё: читаем только начало.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        ranges.push(new Headers(init.headers).get("range"));
        const big = new Uint8Array(64 * 1024);
        big.set(WEBP);
        return new Response(big);
      }),
    );
    const { storageImageInfo } = await import("./media.server");
    const info = await storageImageInfo(ctx, "p.jpg");
    expect(signed).toEqual([`${ctx.tenant.id}/p.jpg`]);
    expect(ranges).toEqual(["bytes=0-15"]);
    expect(info?.head).toEqual(WEBP.slice(0, 16));
    expect(fitsZernio("instagram", "p.jpg", info!)).toBe(false);
  });
});

describe("сбой хранилища — ошибка, а не «нет фото»", () => {
  afterEach(() => {
    vi.doUnmock("@/core/db/client.server");
    vi.resetModules();
  });

  function mockBucket(info: (key: string) => { data: unknown; error: unknown }) {
    vi.resetModules();
    vi.doMock("@/core/db/client.server", () => ({
      serviceDb: () => ({ storage: { from: () => ({ info: async (k: string) => info(k) }) } }),
    }));
  }

  it("ошибка bucket.info бросается и не кэшируется", async () => {
    let calls = 0;
    mockBucket(() => {
      calls++;
      return { data: null, error: { status: 503, message: "Service Unavailable" } };
    });
    const { storageImageInfo } = await import("./media.server");
    await expect(storageImageInfo(ctx, "p.jpg")).rejects.toThrow();
    await expect(storageImageInfo(ctx, "p.jpg")).rejects.toThrow();
    expect(calls).toBe(2);
  });

  it("файла нет ни под новым, ни под старым ключом — null", async () => {
    mockBucket(() => ({ data: null, error: { statusCode: "404", message: "Object not found" } }));
    const { storageImageInfo } = await import("./media.server");
    expect(await storageImageInfo(ctx, "gone.jpg")).toBeNull();
  });
});
