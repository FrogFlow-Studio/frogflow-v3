import { describe, expect, it } from "vitest";
import { CONTACT_FIELDS, redactOrder, redactOrders } from "./redact";

describe("заказ для бухгалтера", () => {
  const order = {
    id: 7,
    order_no: 12,
    status: "delivered",
    total: 5000,
    paid_amount: 5000,
    currency: "KZT",
    telegram_id: 55501,
    display_name: "Анна",
    username: "anna",
    contact: "+77001112233",
    customer_email: "a@b.kz",
    user_key: "tg_55501",
    zernio_conversation_id: "conv",
    fulfillment_address: "Абая 1",
    fulfillment_note: "домофон",
    admin_note: "звонить",
    payment_proof_path: "proofs/7.jpg",
    order_items: [{ name_snapshot: "Прописи", quantity: 1, price_snapshot: 5000 }],
  };

  it("суммы, статус, чек и позиции остаются; контактов нет", () => {
    const r = redactOrder(order);
    expect(r).toMatchObject({
      id: 7,
      order_no: 12,
      status: "delivered",
      total: 5000,
      paid_amount: 5000,
      payment_proof_path: "proofs/7.jpg",
      order_items: order.order_items,
      telegram_id: 0,
    });
    for (const f of CONTACT_FIELDS) expect(r[f as keyof typeof r]).toBeNull();
    expect(JSON.stringify(Object.values(r))).not.toMatch(
      /Анна|anna|7700|a@b|55501|Абая|домофон|звонить|conv/,
    );
  });

  it("исходный заказ не меняется; список — поштучно", () => {
    const [r] = redactOrders([order]);
    expect(r!.contact).toBeNull();
    expect(order.contact).toBe("+77001112233");
  });
});

describe("журнал заказа для бухгалтера", () => {
  it("почта из события отправки письма не видна; смены статусов и суммы видны", async () => {
    const { redactEventPayload } = await import("./redact");
    // email_sent / email_failed пишут в `to` почту покупателя (core/orders/email.ts).
    expect(redactEventPayload({ order_id: 7, to: "anna@example.com", error: "smtp" })).toEqual({});
    expect(redactEventPayload({ to: "anna_k", from: "Анна" })).toEqual({});
    expect(
      redactEventPayload({
        from: "awaiting_payment",
        to: "paid",
        amount: 5000,
        method: "kaspi",
        reason: "покупатель Анна +7700",
      }),
    ).toEqual({ from: "awaiting_payment", to: "paid", amount: 5000, method: "kaspi" });
    expect(redactEventPayload({ method: "+7 700 111 22 33" })).toEqual({});
  });

  it("поиск бухгалтера — только по положительному номеру заказа", async () => {
    const { accountantSearch } = await import("./redact");
    expect(accountantSearch("123")).toBe("123");
    expect(accountantSearch(" #0123 ")).toBe("123");
    for (const q of ["0", "000", "#", "", undefined, "Анна", "+7700", "12a", "-5", "1.5"])
      expect(accountantSearch(q)).toBeUndefined();
  });

  it("файлы материалов в позициях не отдаются", () => {
    const r = redactOrder({
      id: 1,
      order_items: [
        {
          name_snapshot: "Прописи",
          price_snapshot: 500,
          file_url_snapshot: "https://x/y.pdf",
          file_path_snapshot: "bot/y.pdf",
          file_path_kz_snapshot: "bot/y-kz.pdf",
          file_name_snapshot: "y.pdf",
          material_files_by_lang: { ru: [{ path: "bot/y.pdf" }] },
          material_files_snapshot: [{ path: "bot/y.pdf" }],
        },
      ],
    });
    const it0 = r.order_items[0]!;
    expect(it0).toMatchObject({ name_snapshot: "Прописи", price_snapshot: 500 });
    expect(JSON.stringify(r)).not.toContain('y.pdf"}');
    expect(it0.file_url_snapshot).toBeNull();
    expect(it0.file_path_snapshot).toBeNull();
    expect(it0.file_path_kz_snapshot).toBeNull();
    expect(it0.material_files_by_lang).toBeNull();
    expect(it0.material_files_snapshot).toBeNull();
  });
});
