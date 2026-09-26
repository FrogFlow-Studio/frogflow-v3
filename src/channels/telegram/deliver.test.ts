import { describe, expect, it, vi } from "vitest";
import type { TelegramApi } from "./api";
import { COPY } from "./copy";

const signedFileUrl = vi.fn(async (path: string) => `https://storage.invalid/${path}`);
vi.mock("@/core/orders/orders", () => ({ signedFileUrl }));

const { telegramMaterialSender } = await import("./deliver");

function fakeApi() {
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  const api: TelegramApi = {
    call: async (method, payload) => {
      calls.push({ method, payload: payload as Record<string, unknown> });
      return { ok: true };
    },
    fileUrl: (p) => p,
  };
  return { api, calls };
}

describe("telegramMaterialSender", () => {
  it("ссылка приоритетнее пути, если заданы оба: уходит ссылка, файл из хранилища не подписывается", async () => {
    const { api, calls } = fakeApi();
    const send = telegramMaterialSender(api, 42, COPY.ru);
    const r = await send({ name_snapshot: "Пазлы" } as never, [
      { path: "t/x.pdf", name: "Материал", url: "https://cdn.invalid/x.pdf" },
    ]);
    expect(r).toBe("sent");
    expect(signedFileUrl).not.toHaveBeenCalled();
    expect(calls.map((c) => c.method)).toEqual(["sendMessage"]);
    expect(String(calls[0]!.payload.text)).toContain('href="https://cdn.invalid/x.pdf"');
  });
});
