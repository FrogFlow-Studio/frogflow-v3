import { afterEach, describe, expect, it, vi } from "vitest";
import { setEnvForTests } from "@/config/env";
import { downloadAttachment } from "./api.server";

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
