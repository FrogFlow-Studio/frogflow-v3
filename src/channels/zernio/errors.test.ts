import { afterEach, describe, expect, it, vi } from "vitest";
import { setEnvForTests } from "@/config/env";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { OutboxMessage } from "@/core/outbox/outbox";
import { sendInboxMessage, type ZernioTransport } from "./api.server";
import {
  ZernioApiError,
  classifyZernioFailure,
  isAttachmentRejected,
  parseRetryAfter,
  parseZernioFailure,
} from "./errors";
import { zernioOutboxSender } from "./outbox.server";

afterEach(() => {
  setEnvForTests(undefined);
  vi.unstubAllGlobals();
});

const meta = (status: number, code: number) =>
  parseZernioFailure(
    status,
    JSON.stringify({
      error: "текст меняется между релизами",
      type: "platform_error",
      code: "platform_api_error",
      platform: "whatsapp",
      platformError: { code },
    }),
  );

describe("отказ Zernio — по коду, не по тексту", () => {
  it("разбирает конверт ошибки, код Meta и Retry-After", () => {
    expect(meta(400, 131047)).toEqual({
      status: 400,
      type: "platform_error",
      code: "platform_api_error",
      platformCode: 131047,
    });
    expect(parseZernioFailure(429, '{"error":"Too many requests"}', "7")).toEqual({
      status: 429,
      retryAfterSec: 7,
    });
    expect(parseZernioFailure(502, "<html>")).toEqual({ status: 502 });
  });

  it("окно 24 часа — только 131047; 131026 и 131021 — получатель недостижим", () => {
    expect(classifyZernioFailure(meta(400, 131047))).toBe("window_closed");
    expect(classifyZernioFailure(meta(400, 131026))).toBe("unreachable");
    expect(classifyZernioFailure(meta(400, 131021))).toBe("unreachable");
  });

  it("постоянные: 404, ключ, права, Direct Send не допущен, ошибка проверки запроса", () => {
    const f = (status: number, body: object) => parseZernioFailure(status, JSON.stringify(body));
    expect(classifyZernioFailure(f(404, { type: "not_found", code: "account_not_found" }))).toBe(
      "permanent",
    );
    expect(classifyZernioFailure(f(401, { code: "invalid_credentials" }))).toBe("permanent");
    expect(classifyZernioFailure(f(400, { code: "DIRECT_SEND_BLOCKED" }))).toBe("permanent");
    expect(classifyZernioFailure(f(400, { type: "invalid_request_error" }))).toBe("permanent");
  });

  it('код Meta на верхнем уровне ({"code": "131056"}) читается так же, как в platformError', () => {
    const top = parseZernioFailure(
      400,
      JSON.stringify({ error: "Too many messages sent to this recipient", code: "131056" }),
    );
    expect(top.platformCode).toBe(131056);
    expect(classifyZernioFailure(top)).toBe("rate_limited");
    expect(classifyZernioFailure(meta(400, 131056))).toBe("rate_limited");
    const window = parseZernioFailure(400, JSON.stringify({ code: 131047 }));
    expect(classifyZernioFailure(window)).toBe("window_closed");
    expect(classifyZernioFailure(parseZernioFailure(400, '{"code":"131047"}'))).toBe(
      "window_closed",
    );
  });

  it("Retry-After секундами и HTTP-датой", () => {
    const now = Date.parse("2026-09-27T16:00:00Z");
    expect(parseRetryAfter("30", now)).toBe(30);
    expect(parseRetryAfter("Sun, 27 Sep 2026 16:02:00 GMT", now)).toBe(120);
    expect(parseRetryAfter("Sun, 27 Sep 2026 15:00:00 GMT", now)).toBe(0);
    expect(parseRetryAfter("скоро", now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });

  it("500 и таймаут неоднозначны: сообщение могло уйти", () => {
    expect(classifyZernioFailure({ status: 500 })).toBe("ambiguous");
    expect(classifyZernioFailure({ status: null })).toBe("ambiguous");
    expect(classifyZernioFailure(undefined)).toBe("ambiguous");
  });

  it("временные: 429, Direct Send ограничен, 131056, 502/503; неизвестный 4xx Meta — постоянный", () => {
    expect(classifyZernioFailure(parseZernioFailure(429, "{}", "5"))).toBe("rate_limited");
    expect(classifyZernioFailure(parseZernioFailure(400, '{"code":"DIRECT_SEND_LIMITED"}'))).toBe(
      "rate_limited",
    );
    expect(classifyZernioFailure(meta(400, 131056))).toBe("rate_limited");
    expect(classifyZernioFailure({ status: 502 })).toBe("temporary");
    expect(classifyZernioFailure({ status: 503 })).toBe("temporary");
    expect(classifyZernioFailure(meta(400, 2))).toBe("temporary");
    expect(classifyZernioFailure(meta(400, 100))).toBe("permanent");
  });

  it("sendInboxMessage отдаёт поля отказа, а продавцу — верную причину", async () => {
    setEnvForTests({ ZERNIO_API_KEY: "sk_test" });
    const reply = (status: number, body: object, headers: Record<string, string> = {}) =>
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify(body), { status, headers })),
      );
    reply(400, { type: "platform_error", platformError: { code: 131026 } });
    const unreachable = await sendInboxMessage("c1", "a1", "Привет", { platform: "whatsapp" });
    expect(unreachable.failure?.platformCode).toBe(131026);
    expect(unreachable.error).toMatch(/не принимает сообщения WhatsApp/);
    expect(unreachable.error).not.toMatch(/24 час/);

    reply(429, { error: "Too many requests" }, { "Retry-After": "12" });
    const limited = await sendInboxMessage("c1", "a1", "Привет", { platform: "instagram" });
    expect(limited.failure).toEqual({ status: 429, retryAfterSec: 12 });
  });
});

describe("очередь: отправитель Zernio решает по коду", () => {
  const ctx = {} as TenantContext;
  const msg = (platform: "whatsapp" | "instagram", phone?: string): OutboxMessage => ({
    kind: "customer_notice",
    target: { channel: "zernio", conversationId: "c1", accountId: "a1", platform, phone },
    text: "Заказ отправлен",
    audience: "customer",
  });
  const transport = (failure: ReturnType<typeof parseZernioFailure>): ZernioTransport => ({
    send: async () => ({ ok: false, error: "причина", failure }),
    tail: async () => [],
  });

  it("131026 — не окно: шаблон не пробуем, повторов нет", async () => {
    const start = vi.fn();
    const send = zernioOutboxSender(transport(meta(400, 131026)), start);
    expect(await send(ctx, msg("whatsapp", "77001234567"))).toMatchObject({
      ok: false,
      permanent: true,
    });
    expect(start).not.toHaveBeenCalled();
  });

  it("131047 с номером — пишем первым; без номера — повторять бессмысленно", async () => {
    const db = fakeDb();
    db.tables.app_settings = [];
    const withDb = { db } as unknown as TenantContext;
    const start = vi.fn(async () => ({ ok: true as const }));
    const send = zernioOutboxSender(transport(meta(400, 131047)), start);
    expect(await send(withDb, msg("whatsapp", "77001234567"))).toEqual({ ok: true });
    expect(start).toHaveBeenCalledWith({
      accountId: "a1",
      phone: "77001234567",
      message: "Заказ отправлен",
    });
    expect(await send(withDb, msg("whatsapp"))).toMatchObject({ ok: false, permanent: true });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("429 — ждём Retry-After всей очередью; 131056 — только этот получатель; 503 — повтор", async () => {
    const limited = zernioOutboxSender(transport(parseZernioFailure(429, "{}", "30")));
    const r429 = await limited(ctx, msg("instagram"));
    expect(r429).toMatchObject({ ok: false, retryAfterSec: 30 });
    expect(r429).not.toHaveProperty("recipientOnly");
    const one = zernioOutboxSender(transport(parseZernioFailure(400, '{"code":"131056"}')));
    expect(await one(ctx, msg("whatsapp"))).toMatchObject({
      ok: false,
      retryAfterSec: 60,
      recipientOnly: true,
    });
    const down = zernioOutboxSender(transport({ status: 503 }));
    expect(await down(ctx, msg("instagram"))).toEqual({ ok: false, error: "причина" });
  });

  it("500 или таймаут: сверяем переписку, вслепую не повторяем", async () => {
    const withTail = (tail: ZernioTransport["tail"]): ZernioTransport => ({
      send: async () => ({ ok: false, error: "причина", failure: { status: 500 } }),
      tail,
    });
    const recent = new Date(Date.now() + 1000).toISOString();
    const ours = { direction: "outgoing", message: "Заказ отправлен", createdAt: recent };
    const theirs = { direction: "incoming", message: "Заказ отправлен", createdAt: recent };
    // Наше сообщение в переписке есть — доставлено.
    expect(await zernioOutboxSender(withTail(async () => [ours]))(ctx, msg("instagram"))).toEqual({
      ok: true,
    });
    // Переписка прочитана, нашего нет — повторяем.
    expect(await zernioOutboxSender(withTail(async () => [theirs]))(ctx, msg("instagram"))).toEqual(
      { ok: false, error: "причина" },
    );
    // Пусто или не прочитать — «возможно доставлено», без повтора.
    for (const tail of [async () => [], async () => Promise.reject(new Error("503"))])
      expect(await zernioOutboxSender(withTail(tail))(ctx, msg("instagram"))).toEqual({
        ok: false,
        error: "Возможно доставлено, проверьте переписку: причина",
        permanent: true,
      });
  });
});

describe("отказ во вложении — по коду", () => {
  const f = (status: number, body: object) => parseZernioFailure(status, JSON.stringify(body));
  it("PLATFORM_LIMITATION и 131052 — вложение не принято", () => {
    const limitation = f(400, {
      error: "Attachments are not supported for this platform",
      type: "invalid_request_error",
      code: "PLATFORM_LIMITATION",
    });
    expect(isAttachmentRejected(limitation)).toBe(true);
    expect(isAttachmentRejected(new ZernioApiError("Zernio API 400: …", limitation))).toBe(true);
    expect(isAttachmentRejected(meta(400, 131052))).toBe(true);
  });

  it("ошибка проверки полей, окно, сеть и обычный Error — не отказ вложения", () => {
    const buttons = f(400, {
      error: "buttons[0].url is required",
      type: "invalid_request_error",
      code: "missing_required_field",
      param: "buttons[0].url",
    });
    expect(isAttachmentRejected(buttons)).toBe(false);
    expect(isAttachmentRejected(f(400, { error: "buttons[0].url is required" }))).toBe(false);
    expect(isAttachmentRejected(meta(400, 131047))).toBe(false);
    expect(isAttachmentRejected({ status: null })).toBe(false);
    expect(isAttachmentRejected(new Error("Zernio API 400: attachment PLATFORM_LIMITATION"))).toBe(
      false,
    );
    expect(isAttachmentRejected(undefined)).toBe(false);
  });
});

describe("нет ответа Zernio", () => {
  it("соединение не установлено — повтор безопасен; таймаут — неоднозначен", async () => {
    setEnvForTests({ ZERNIO_API_KEY: "sk_test" });
    const refused = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ECONNREFUSED" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(refused)),
    );
    const a = await sendInboxMessage("c1", "a1", "Привет");
    expect(classifyZernioFailure(a.failure)).toBe("temporary");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new DOMException("timed out", "TimeoutError"))),
    );
    const b = await sendInboxMessage("c1", "a1", "Привет");
    expect(classifyZernioFailure(b.failure)).toBe("ambiguous");
    expect(b.error).toMatch(/могло уйти/);
  });

  it("Instagram вне окна (код 10, подкод 2018278) — окно закрыто; код 10 без подкода — нет", () => {
    const body = JSON.stringify({
      type: "platform_error",
      platformError: { code: 10, error_subcode: 2018278, message: "outside of allowed window" },
    });
    const f = parseZernioFailure(400, body);
    expect(f.platformSubcode).toBe(2018278);
    expect(classifyZernioFailure(f)).toBe("window_closed");
    expect(classifyZernioFailure({ status: 400, platformCode: 10 })).not.toBe("window_closed");
  });
});
