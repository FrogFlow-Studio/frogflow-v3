import { afterEach, describe, expect, it, vi } from "vitest";
import { setEnvForTests } from "@/config/env";
import { downloadAttachment, readCapped } from "./api.server";

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
