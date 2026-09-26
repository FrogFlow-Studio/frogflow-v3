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
});
