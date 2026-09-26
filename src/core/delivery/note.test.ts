import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { plain } from "@/channels/zernio/shop-flow";
import {
  DEFAULT_DELIVERY_NOTE,
  DELIVERY_NOTE_KEY,
  DELIVERY_NOTE_MAX,
  withSellerNote,
} from "./note";
import { deliveredMessage } from "./note.server";

/**
 * Просьба продавца (цифровая ниша, сентябрь 2026, в v1 —
 * tests/delivery-message.test.ts): в сообщении после оплаты предупреждать,
 * что повторная отправка платная. Правило её магазина — текст из настроек.
 */
const NOTE =
  "❗❗ Если вы не успели скачать материал в указанный срок или потеряли файл, повторная отправка осуществляется только на ПЛАТНОЙ основе.\n\nЕсли письма нет, проверьте папку «Спам» и напишите мне — я помогу.";
const DELIVERED = "🎉 Заказ #715 выдан. Спасибо за покупку!";

function ctxWith(note?: string): TenantContext {
  const db = fakeDb();
  db.tables.app_settings = note === undefined ? [] : [{ key: DELIVERY_NOTE_KEY, value: note }];
  return { db, tenant: { id: "t1", settings: {} } } as unknown as TenantContext;
}

describe("приписка продавца к сообщению о выдаче", () => {
  it("ставит приписку продавца последним абзацем", async () => {
    const text = plain(await deliveredMessage(ctxWith(NOTE), "instagram", DELIVERED));
    expect(text).toBe(`${DELIVERED}\n\n${NOTE}`);
  });

  it("без приписки отправляет текст по умолчанию", async () => {
    // Как в v1: пустая или не заданная приписка — абзац про «Спам».
    for (const ctx of [ctxWith("   "), ctxWith()]) {
      const text = plain(await deliveredMessage(ctx, "whatsapp", DELIVERED));
      expect(text).toBe(`${DELIVERED}\n\n${DEFAULT_DELIVERY_NOTE}`);
      expect(text).not.toMatch(/ПЛАТНОЙ/);
    }
    expect(DEFAULT_DELIVERY_NOTE).toBe(
      "Если письма нет — проверьте папку «Спам» и напишите сюда, поможем.",
    );
  });

  it("приписка — в Direct и WhatsApp, в Telegram сообщение как было", async () => {
    const ctx = ctxWith(NOTE);
    for (const p of ["instagram", "whatsapp"])
      expect(await deliveredMessage(ctx, p, DELIVERED)).toContain("ПЛАТНОЙ");
    expect(await deliveredMessage(ctx, "telegram", DELIVERED)).toBe(DELIVERED);
  });

  it("текст продавца доходит как написан, а не как разметка; длина ограничена", () => {
    expect(plain(withSellerNote(DELIVERED, "Люблю вас <3 & <b>спасибо</b>"))).toBe(
      `${DELIVERED}\n\nЛюблю вас <3 & <b>спасибо</b>`,
    );
    const long = withSellerNote("x", "я".repeat(DELIVERY_NOTE_MAX + 50));
    expect(long.length).toBe(1 + 2 + DELIVERY_NOTE_MAX);
  });
});
