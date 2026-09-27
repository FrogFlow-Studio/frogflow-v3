import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { orderAccessToken } from "./web-order";

vi.mock("@/core/mail/mail.server", async (orig) => ({
  ...(await orig<typeof import("@/core/mail/mail.server")>()),
  isMailConfigured: () => mailConfigured,
}));
let mailConfigured = true;

const { emailOrderNotice } = await import("./web-notify");
const { smtpMailer } = await import("@/core/mail/mail.server");

const BOT = "00000000-0000-0000-0000-0000000000aa";
const SECRET = "test-secret-test-secret-test-secret-42";
let db: FakeDb;
let ctx: TenantContext;
const order = { id: 7, order_no: 12, display_no: 12, customer_email: "anna@example.com" };

beforeEach(() => {
  mailConfigured = true;
  db = fakeDb();
  db.tables.zernio_logs = [];
  db.tables.app_settings = [{ bot_id: BOT, key: "shop_name", value: "Прописи" }];
  ctx = {
    tenant: { id: BOT, name: "shop", modules: {}, settings: { slug: "propisi" } },
    appUrl: "https://www.frogflow.tech",
    db,
  } as unknown as TenantContext;
});

describe("письмо покупателю с сайта о заказе", () => {
  it("текст уведомления без разметки и подписанная ссылка на страницу заказа", async () => {
    const sent: Array<{ to: string; subject: string; text: string; html: string }> = [];
    const ok = await emailOrderNotice(
      ctx,
      order,
      "❌ Заказ #12 <b>отклонён</b> продавцом.",
      SECRET,
      async (m) => {
        sent.push(m);
        return { ok: true };
      },
    );
    expect(ok).toBe(true);
    expect(sent[0]!.to).toBe("anna@example.com");
    expect(sent[0]!.subject).toBe("Заказ №12 в магазине «Прописи»");
    expect(sent[0]!.text).toContain("❌ Заказ #12 отклонён продавцом.");
    expect(sent[0]!.text).not.toContain("<b>");
    const url = `https://www.frogflow.tech/s/propisi/order/7?t=${orderAccessToken(SECRET, BOT, 7)}`;
    expect(sent[0]!.text).toContain(url);
    expect(db.tables.zernio_logs!.map((e) => e.event_type)).toEqual(["order.email_sent"]);
  });

  it("почта платформы не настроена — письма нет, продавец видит «не отправлено»", async () => {
    mailConfigured = false;
    expect(await emailOrderNotice(ctx, order, "x", SECRET, smtpMailer)).toBe(false);
    expect(JSON.stringify(db.tables.zernio_logs)).toContain("SMTP не настроен");
  });

  it("у заказа нет почты — тихо false", async () => {
    const mailer = vi.fn();
    expect(
      await emailOrderNotice(ctx, { ...order, customer_email: null }, "x", SECRET, mailer),
    ).toBe(false);
    expect(mailer).not.toHaveBeenCalled();
    expect(db.tables.zernio_logs).toEqual([]);
  });

  it("письмо не ушло — событие email_failed с причиной", async () => {
    await emailOrderNotice(ctx, order, "x", SECRET, async () => ({ ok: false, error: "535" }));
    expect(JSON.stringify(db.tables.zernio_logs)).toContain("email_failed");
  });
});
