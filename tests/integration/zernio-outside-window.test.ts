import { describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT } from "./live";
import { requireTenant, tenantContext } from "@/core/tenant/resolve.server";
import { getSetting, setSetting } from "@/core/settings/settings";
import { zernioOutboxSender } from "@/channels/zernio/outbox.server";
import type { ZernioTransport } from "@/channels/zernio/api.server";

/**
 * WhatsApp вне 24-часового окна: обычная отправка отказала — пишем первым по
 * номеру шаблоном продавца, а без шаблона служебным сообщением.
 */
const closed: ZernioTransport = {
  send: async () => ({
    ok: false,
    error:
      "Прошло больше 24 часов с последнего сообщения покупателя — WhatsApp разрешает писать только одобренным шаблоном.",
  }),
  tail: async () => [],
};
const msg = {
  kind: "customer_notice",
  target: {
    channel: "zernio" as const,
    conversationId: "conv",
    accountId: "acc",
    platform: "whatsapp" as const,
    phone: "+7 701 000 00 00",
  },
  text: "Заказ #5 <b>выдан</b>",
  audience: "customer" as const,
};

describe.skipIf(!liveReady)("WhatsApp вне окна", () => {
  it("шаблон из настроек — параметром, без шаблона — Direct Send; Instagram не трогаем", async () => {
    const ctx = tenantContext(await requireTenant({ by: "id", value: DEMO_BOT }));
    const calls: unknown[] = [];
    const start = async (p: unknown) => {
      calls.push(p);
      return { ok: true as const, conversationId: "new" };
    };
    const prev = await getSetting(ctx, "whatsapp_bot_notify_template");
    try {
      await setSetting(ctx, "whatsapp_bot_notify_template", "order_update:ru");
      expect(await zernioOutboxSender(closed, start)(ctx, msg)).toEqual({ ok: true });
      expect(calls[0]).toMatchObject({
        accountId: "acc",
        phone: "+7 701 000 00 00",
        templateName: "order_update",
        templateLanguage: "ru",
        templateParams: ["Заказ #5 выдан"],
      });
      await setSetting(ctx, "whatsapp_bot_notify_template", "");
      await zernioOutboxSender(closed, start)(ctx, msg);
      expect(calls[1]).toMatchObject({ phone: "+7 701 000 00 00", message: "Заказ #5 выдан" });

      const ig = await zernioOutboxSender(closed, start)(ctx, {
        ...msg,
        target: { ...msg.target, platform: "instagram" },
      });
      expect(ig.ok).toBe(false);
      expect(calls).toHaveLength(2);
    } finally {
      await setSetting(ctx, "whatsapp_bot_notify_template", prev ?? "");
    }
  });
});
