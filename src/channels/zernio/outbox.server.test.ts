import { describe, expect, it } from "vitest";
import { parseNotifyTemplate, templateParam, TEMPLATE_PARAM_MAX } from "./outbox.server";
import { buttonsComponent } from "./templates.server";

describe("WhatsApp: шаблон уведомлений и кнопки шаблона", () => {
  it("разбирает «имя:язык» и пустое значение", () => {
    expect(parseNotifyTemplate("order_update:ru")).toEqual({
      name: "order_update",
      language: "ru",
    });
    expect(parseNotifyTemplate(" order_update ")).toEqual({
      name: "order_update",
      language: undefined,
    });
    expect(parseNotifyTemplate("")).toBeNull();
  });
  it("кнопки уходят в Meta компонентом BUTTONS, не больше трёх, пустые отбрасываются", () => {
    expect(buttonsComponent([])).toBeNull();
    expect(
      buttonsComponent([
        { type: "QUICK_REPLY", text: " Да " },
        { type: "URL", text: "Сайт", url: "https://shop.kz/" },
        { type: "PHONE_NUMBER", text: "Позвонить", phone: "+7 (701) 123-45-67" },
        { type: "QUICK_REPLY", text: "лишняя" },
        { type: "QUICK_REPLY", text: "" },
      ]),
    ).toEqual({
      type: "BUTTONS",
      buttons: [
        { type: "QUICK_REPLY", text: "Да" },
        { type: "URL", text: "Сайт", url: "https://shop.kz/" },
        { type: "PHONE_NUMBER", text: "Позвонить", phone_number: "+77011234567" },
      ],
    });
  });
});

describe("очередь Zernio: ключ идемпотентности", () => {
  it("один на сообщение очереди — и для диалога, и для первого сообщения по номеру", async () => {
    const { fakeDb } = await import("../../../tests/fake-db");
    const { zernioOutboxSender } = await import("./outbox.server");
    const db = fakeDb();
    db.tables.app_settings = [];
    const scopes: unknown[] = [];
    const send = zernioOutboxSender(
      {
        send: async (_c, _a, _t, opts) => {
          scopes.push(opts?.idempotencyScope);
          return { ok: false, error: "окно", failure: { status: 400, platformCode: 131047 } };
        },
        tail: async () => [],
      },
      async (p) => {
        scopes.push(p.idempotencyScope);
        return { ok: true };
      },
    );
    const r = await send({ db } as never, {
      kind: "customer_notice",
      eventId: "outbox:abc",
      target: {
        channel: "zernio",
        conversationId: "c1",
        accountId: "a1",
        platform: "whatsapp",
        phone: "77001234567",
      },
      text: "Заказ отправлен",
      audience: "customer",
    });
    expect(r).toEqual({ ok: true });
    expect(scopes).toEqual(["outbox:abc", "outbox:abc"]);
  });
});

describe("параметр шаблона WhatsApp (ограничения Meta)", () => {
  it("без переносов и табуляций, не больше трёх пробелов подряд", () => {
    expect(templateParam("Заказ готов.\n\nЗаберите\tзавтра     утром")).toBe(
      "Заказ готов. · Заберите завтра   утром",
    );
  });
  it("длинный текст режется по графемам с многоточием", () => {
    const out = templateParam("👍🏽".repeat(TEMPLATE_PARAM_MAX + 50));
    const graphemes = [...new Intl.Segmenter("ru", { granularity: "grapheme" }).segment(out)];
    expect(graphemes).toHaveLength(TEMPLATE_PARAM_MAX);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("�");
  });
});
