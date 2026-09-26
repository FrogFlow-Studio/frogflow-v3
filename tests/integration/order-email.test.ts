import { afterAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT } from "./live";
import { serviceDb } from "@/core/db/client.server";
import { requireTenant, tenantContext } from "@/core/tenant/resolve.server";
import { emailOrderMaterials } from "@/core/orders/email";
import type { OrderWithItems } from "@/core/orders/orders";
import type { Mailer } from "@/core/mail/mail.server";

/** Копия материалов на почту покупателю из Direct: ссылки собраны, письмо ушло, итог в таймлайне. */
const ORDER_ID = 987654321;

const order = {
  id: ORDER_ID,
  order_no: 77,
  display_no: null,
  platform: "instagram",
  customer_email: "buyer@example.com",
  order_items: [
    {
      id: "i1",
      order_id: ORDER_ID,
      name_snapshot: "Пазлы",
      quantity: 1,
      product_id: null,
      product_variant_id: null,
      delivered_language: null,
      file_url_snapshot: "https://example.com/puzzles.pdf",
      file_path_snapshot: null,
      file_name_snapshot: "Пазлы.pdf",
      material_files_by_lang: null,
    },
  ],
} as unknown as OrderWithItems;

describe.skipIf(!liveReady)("письмо с материалами по заказу из Direct", () => {
  afterAll(async () => {
    await serviceDb()
      .from("zernio_logs")
      .delete()
      .eq("bot_id", DEMO_BOT)
      .like("event_id", `order:${ORDER_ID}:%`);
  });

  it("собирает ссылки, отправляет и пишет событие; Telegram и заказ без почты пропускает", async () => {
    const ctx = tenantContext(await requireTenant({ by: "id", value: DEMO_BOT }));
    const sent: Parameters<Mailer>[0][] = [];
    const mailer: Mailer = async (m) => {
      sent.push(m);
      return { ok: true };
    };
    const r = await emailOrderMaterials(ctx, order, mailer);
    expect(r.sent).toBe(true);
    expect(sent[0]!.to).toBe("buyer@example.com");
    expect(sent[0]!.subject).toContain("№77");
    expect(sent[0]!.text).toContain("https://example.com/puzzles.pdf");

    const { data } = await ctx.db
      .from("zernio_logs")
      .select("event_type")
      .like("event_id", `order:${ORDER_ID}:%`);
    expect(data?.map((d) => d.event_type)).toEqual(["order.email_sent"]);

    expect((await emailOrderMaterials(ctx, { ...order, platform: "telegram" }, mailer)).sent).toBe(
      false,
    );
    expect((await emailOrderMaterials(ctx, { ...order, customer_email: null }, mailer)).sent).toBe(
      false,
    );
    expect(sent).toHaveLength(1);
  });
});
