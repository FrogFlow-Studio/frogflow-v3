import { describe, expect, it } from "vitest";
import { ZernioApiError } from "@/channels/zernio/errors";
import { zernioInstagram } from "./zernio.server";

/**
 * Адаптер Zernio v4: пути, поля и итог отправки. Сеть подменена на запись
 * запросов, разбор ошибок — настоящий (src/channels/zernio/errors.ts).
 */

type Call = { endpoint: string; opts: { body?: unknown; idempotencyKey?: string } };
function fakeRequest(fail?: unknown) {
  const calls: Call[] = [];
  const request = (async (endpoint: string, opts: Call["opts"] = {}) => {
    calls.push({ endpoint, opts });
    if (fail) throw fail;
    return {};
  }) as unknown as Parameters<typeof zernioInstagram>[1];
  return { calls, request };
}
const signal = AbortSignal.timeout(1000);

describe("zernioInstagram", () => {
  it("публичный ответ — по посту с commentId, Direct — private-reply без кнопок", async () => {
    const { calls, request } = fakeRequest();
    const ch = zernioInstagram("acc1", request);
    expect(await ch.publicReply("p1", "c1", "Написала в Direct", signal)).toBe("sent");
    expect(await ch.privateReply("p1", "c1", "Ответьте «+»", signal)).toBe("sent");
    expect(calls[0]).toEqual({
      endpoint: "/inbox/comments/p1",
      opts: expect.objectContaining({
        body: { accountId: "acc1", message: "Написала в Direct", commentId: "c1" },
        idempotencyKey: "v4-public:p1:c1",
      }),
    });
    expect(calls[1]!.endpoint).toBe("/inbox/comments/p1/c1/private-reply");
    expect(calls[1]!.opts.body).toEqual({ accountId: "acc1", message: "Ответьте «+»" });
  });

  it("карточка — одно сообщение с postback-кнопкой, заголовок в пределе 20 знаков", async () => {
    const { calls, request } = fakeRequest();
    const ch = zernioInstagram("acc1", request);
    await ch.sendCard(
      "conv1",
      "Тетрадь — 4 500 ₸",
      [{ kind: "buy", productId: "prod-1", label: "Купить прямо сейчас со скидкой" }],
      signal,
    );
    expect(calls[0]!.endpoint).toBe("/inbox/conversations/conv1/messages");
    const body = calls[0]!.opts.body as {
      buttons: Array<{ type: string; title: string; payload: string }>;
    };
    expect(body.buttons).toHaveLength(1);
    expect(body.buttons[0]).toMatchObject({ type: "postback", payload: "v4buy:prod-1" });
    expect(body.buttons[0]!.title.length).toBeLessThanOrEqual(20);
  });

  it("500 и тайм-аут — unknown (могло дойти), 400 и 403 — failed", async () => {
    const cases: Array<[unknown, string]> = [
      [new ZernioApiError("500", { status: 500 }), "unknown"],
      [new ZernioApiError("нет ответа", { status: null }), "unknown"],
      [new Error("не JSON"), "unknown"],
      [new ZernioApiError("400", { status: 400 }), "failed"],
      [new ZernioApiError("403", { status: 403 }), "failed"],
      [new ZernioApiError("429", { status: 429 }), "failed"],
    ];
    for (const [err, want] of cases) {
      const { request } = fakeRequest(err);
      expect(await zernioInstagram("acc1", request).privateReply("p", "c", "t", signal)).toBe(want);
    }
  });
});
