import { afterEach, describe, expect, it, vi } from "vitest";
import { setEnvForTests } from "@/config/env";
import { sendInboxMessage } from "./api.server";

afterEach(() => {
  setEnvForTests(undefined);
  vi.unstubAllGlobals();
});

function capture() {
  setEnvForTests({ ZERNIO_API_KEY: "sk_test" });
  const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return () => {
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    return JSON.parse(String(init.body)) as Record<string, unknown>;
  };
}

describe("sendInboxMessage — тело ответа в Direct", () => {
  it("обычный ответ в Direct уходит без тега сообщения", async () => {
    const body = capture();
    expect((await sendInboxMessage("conv-1", "acc-1", "Здравствуйте!")).ok).toBe(true);
    expect(body()).toEqual({ accountId: "acc-1", message: "Здравствуйте!" });
  });

  it("тег ставится только вместе с типом сообщения", async () => {
    const body = capture();
    await sendInboxMessage("conv-1", "acc-1", "Ваш заказ готов", {
      messagingType: "MESSAGE_TAG",
      messageTag: "HUMAN_AGENT",
    });
    expect(body()).toMatchObject({ messagingType: "MESSAGE_TAG", messageTag: "HUMAN_AGENT" });
  });

  it("область ключа идёт в заголовок Idempotency-Key, а не в тело", async () => {
    setEnvForTests({ ZERNIO_API_KEY: "sk_test" });
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await sendInboxMessage("conv-1", "acc-1", "Привет", { idempotencyScope: "chat:d1" });
    await sendInboxMessage("conv-1", "acc-1", "Привет", { idempotencyScope: "chat:d1" });
    await sendInboxMessage("conv-1", "acc-1", "Привет");
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const headers = calls.map(([, init]) => init.headers as Record<string, string>);
    expect(headers[0]!["Idempotency-Key"]).toMatch(/^[0-9a-f]{64}$/);
    expect(headers[1]!["Idempotency-Key"]).toBe(headers[0]!["Idempotency-Key"]);
    expect(headers[2]).not.toHaveProperty("Idempotency-Key");
    expect(JSON.parse(String(calls[0]![1].body))).toEqual({
      accountId: "acc-1",
      message: "Привет",
    });
  });

  it("Instagram: текст и вложение уходят двумя отдельными запросами (сначала текст, затем медиа)", async () => {
    setEnvForTests({ ZERNIO_API_KEY: "sk_test" });
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await sendInboxMessage("conv-1", "acc-1", "Посмотрите фото товара", {
      platform: "instagram",
      attachmentUrl: "https://cdn.example.com/item.jpg",
      attachmentType: "image",
      idempotencyScope: "chat:123",
    });
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const body1 = JSON.parse(String(calls[0]![1].body));
    const body2 = JSON.parse(String(calls[1]![1].body));

    expect(body1).toEqual({
      accountId: "acc-1",
      message: "Посмотрите фото товара",
    });
    expect(body1).not.toHaveProperty("attachmentUrl");

    expect(body2).toEqual({
      accountId: "acc-1",
      attachmentUrl: "https://cdn.example.com/item.jpg",
      attachmentType: "image",
    });
    expect(body2).not.toHaveProperty("message");
  });

  it("Instagram: вложение без текста уходит одним запросом без поля message", async () => {
    setEnvForTests({ ZERNIO_API_KEY: "sk_test" });
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await sendInboxMessage("conv-1", "acc-1", "", {
      platform: "instagram",
      attachmentUrl: "https://cdn.example.com/photo.jpg",
      attachmentType: "image",
    });
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      accountId: "acc-1",
      attachmentUrl: "https://cdn.example.com/photo.jpg",
      attachmentType: "image",
    });
    expect(body).not.toHaveProperty("message");
  });

  it("Instagram: видео уходит как attachmentType video", async () => {
    setEnvForTests({ ZERNIO_API_KEY: "sk_test" });
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await sendInboxMessage("conv-1", "acc-1", "", {
      platform: "instagram",
      attachmentUrl: "https://cdn.example.com/product.mp4",
      attachmentType: "video",
    });
    expect(r.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      accountId: "acc-1",
      attachmentUrl: "https://cdn.example.com/product.mp4",
      attachmentType: "video",
    });
  });

  it("Supabase signed media URL: rotating token keeps the same idempotency key", async () => {
    setEnvForTests({ ZERNIO_API_KEY: "sk_test" });
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const send = (token: string) =>
      sendInboxMessage("conv-1", "acc-1", "", {
        platform: "instagram",
        attachmentUrl: `https://project.supabase.co/storage/v1/object/sign/product-images/item.jpg?token=${token}`,
        attachmentType: "image",
        idempotencyScope: "consultant-media:mid-1:0",
      });

    await send("first-temporary-token");
    await send("second-temporary-token");

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const headers = calls.map(([, init]) => init.headers as Record<string, string>);
    expect(headers[0]!["Idempotency-Key"]).toMatch(/^[0-9a-f]{64}$/);
    expect(headers[1]!["Idempotency-Key"]).toBe(headers[0]!["Idempotency-Key"]);
    const bodies = calls.map(
      ([, init]) => JSON.parse(String(init.body)) as Record<string, unknown>,
    );
    expect(bodies[0]!.attachmentUrl).toContain("first-temporary-token");
    expect(bodies[1]!.attachmentUrl).toContain("second-temporary-token");
  });
});
