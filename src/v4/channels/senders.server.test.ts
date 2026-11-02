import { describe, expect, it } from "vitest";
import type { TelegramApi, TgResult } from "@/channels/telegram/api";
import type { SendResult } from "@/channels/zernio/api.server";
import { CONNECT_FAILED } from "@/channels/zernio/errors";
import { telegramOutcome, v4BuyerSender, v4SellerTarget, zernioOutcome } from "./senders.server";

/**
 * Настоящие отправители v4: что сказал канал → sent / failed / unknown.
 * «Могло дойти» (обрыв, тайм-аут, 5xx, 500 Zernio) — unknown, без повтора.
 */

function fakeTelegram(answers: Record<string, TgResult>) {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const api: TelegramApi = {
    call: async <T>(method: string, payload?: unknown) => {
      const p = payload as Record<string, unknown>;
      calls.push({ method, payload: p });
      return (answers[String(p.chat_id)] ?? { ok: true }) as TgResult<T>;
    },
    fileUrl: (f) => f,
  };
  return { api, calls };
}

const signal = AbortSignal.timeout(1000);

describe("итог отправки", () => {
  it("Telegram: принял — sent; 4xx — failed; 429, 5xx, обрыв — unknown", () => {
    expect(telegramOutcome({ ok: true })).toBe("sent");
    expect(telegramOutcome({ ok: false, error_code: 403 })).toBe("failed");
    expect(telegramOutcome({ ok: false, error_code: 429 })).toBe("unknown");
    expect(telegramOutcome({ ok: false, error_code: 502 })).toBe("unknown");
    expect(telegramOutcome({ ok: false })).toBe("unknown");
  });

  it("Zernio: 500 и тайм-аут — unknown; 400 и «не соединились» — failed; не подключён — failed", () => {
    expect(zernioOutcome({ ok: true })).toBe("sent");
    expect(zernioOutcome({ ok: false, failure: { status: 500 } })).toBe("unknown");
    expect(zernioOutcome({ ok: false, failure: { status: null } })).toBe("unknown");
    expect(zernioOutcome({ ok: false, failure: { status: 400 } })).toBe("failed");
    expect(zernioOutcome({ ok: false, failure: { status: null, code: CONNECT_FAILED } })).toBe(
      "failed",
    );
    expect(zernioOutcome({ ok: false, error: "нет ключа" })).toBe("failed");
  });
});

describe("отправитель покупателю", () => {
  it("Telegram — в чат покупателя ботом магазина, без превью ссылки", async () => {
    const tg = fakeTelegram({});
    const send = v4BuyerSender({ telegram: tg.api, zernioAccount: {} });
    expect(
      await send("telegram", { externalId: "777", conversationId: null }, "Ваш заказ", signal),
    ).toBe("sent");
    expect(tg.calls).toEqual([
      {
        method: "sendMessage",
        payload: { chat_id: "777", text: "Ваш заказ", link_preview_options: { is_disabled: true } },
      },
    ]);
  });

  it("Telegram отказал (бот заблокирован) — failed; бота нет — failed", async () => {
    const tg = fakeTelegram({ "777": { ok: false, error_code: 403 } });
    expect(
      await v4BuyerSender({ telegram: tg.api, zernioAccount: {} })(
        "telegram",
        { externalId: "777", conversationId: null },
        "x",
        signal,
      ),
    ).toBe("failed");
    expect(
      await v4BuyerSender({ telegram: null, zernioAccount: {} })(
        "telegram",
        { externalId: "777", conversationId: null },
        "x",
        signal,
      ),
    ).toBe("failed");
  });

  it("Instagram — в переписку Zernio с аккаунтом магазина; 500 — unknown", async () => {
    const calls: unknown[][] = [];
    let answer: SendResult = { ok: true };
    const send = v4BuyerSender({
      telegram: null,
      zernioAccount: { instagram: "acc-ig", whatsapp: "acc-wa" },
      sendInbox: async (...args) => {
        calls.push(args);
        return answer;
      },
    });
    const to = { externalId: "ig-user", conversationId: "conv-1" };
    expect(await send("instagram", to, "Ссылка", signal)).toBe("sent");
    expect(calls).toEqual([
      ["conv-1", "acc-ig", "Ссылка", { platform: "instagram", idempotencyScope: "v4" }],
    ]);
    answer = { ok: false, failure: { status: 500 } };
    expect(await send("whatsapp", to, "Ссылка", signal)).toBe("unknown");
    expect(calls.at(-1)!.slice(0, 2)).toEqual(["conv-1", "acc-wa"]);
  });

  it("нет переписки или аккаунта — failed без вызова Zernio", async () => {
    let called = 0;
    const send = v4BuyerSender({
      telegram: null,
      zernioAccount: { instagram: "acc-ig" },
      sendInbox: async () => {
        called++;
        return { ok: true };
      },
    });
    expect(await send("instagram", { externalId: "u", conversationId: null }, "x", signal)).toBe(
      "failed",
    );
    expect(await send("whatsapp", { externalId: "u", conversationId: "conv" }, "x", signal)).toBe(
      "failed",
    );
    expect(called).toBe(0);
  });
});

describe("адресат уведомлений продавца", () => {
  it("нет бота или чатов — null (уведомление «некуда отправить»)", () => {
    const tg = fakeTelegram({});
    expect(v4SellerTarget({ telegram: null, chatIds: ["1"], lang: "ru" })).toBeNull();
    expect(v4SellerTarget({ telegram: tg.api, chatIds: ["", ""], lang: "ru" })).toBeNull();
  });

  it("каждому чату по одному сообщению, повторы чатов убраны; дошло хоть одному — sent", async () => {
    const tg = fakeTelegram({ "1": { ok: false, error_code: 403 } });
    const t = v4SellerTarget({ telegram: tg.api, chatIds: ["1", "2", "2"], lang: "kk" })!;
    expect(t.lang).toBe("kk");
    expect(await t.send("Чек", signal)).toBe("sent");
    expect(tg.calls.map((c) => c.payload.chat_id)).toEqual(["1", "2"]);
  });

  it("всем точно отказано — failed; хоть один «неизвестно» — unknown", async () => {
    const no = fakeTelegram({
      "1": { ok: false, error_code: 403 },
      "2": { ok: false, error_code: 400 },
    });
    expect(
      await v4SellerTarget({ telegram: no.api, chatIds: ["1", "2"], lang: "ru" })!.send(
        "x",
        signal,
      ),
    ).toBe("failed");
    const maybe = fakeTelegram({ "1": { ok: false, error_code: 403 }, "2": { ok: false } });
    expect(
      await v4SellerTarget({ telegram: maybe.api, chatIds: ["1", "2"], lang: "ru" })!.send(
        "x",
        signal,
      ),
    ).toBe("unknown");
  });
});
