import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setEnvForTests } from "@/config/env";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { ZernioTransport } from "./api.server";

/** Выдача в Instagram/WhatsApp при закрытом окне 24 часа: шаблон, письмо, причина продавцу. */
const alerts: string[] = [];
vi.mock("@/channels/telegram/notify", () => ({
  notifyAdminsHtml: vi.fn(async (_ctx: unknown, html: string) => {
    alerts.push(html);
    return 1;
  }),
}));
let mailOn = false;
vi.mock("@/core/mail/mail.server", () => ({ isMailConfigured: () => mailOn }));

const { zernioDeliverySender } = await import("./outbound.server");

const BOT = "11111111-1111-1111-1111-111111111111";
const order = { id: 9, display_no: 109, order_no: 9, customer_email: null as string | null };
const item = { id: "i1", name_snapshot: "Прописи" } as never;
const mats = [{ path: null, name: "Урок", url: "https://ex.test/l" }];

function setup(template?: string) {
  const db = fakeDb();
  db.tables.app_settings = template
    ? [{ bot_id: BOT, key: "whatsapp_bot_notify_template", value: template }]
    : [];
  return {
    tenant: { id: BOT, settings: { slug: "shop", served_by: "v2" }, modules: { shop: true } },
    db,
    appUrl: "https://app.test",
  } as unknown as TenantContext;
}

const closedTransport = (platformCode = 131047, platformSubcode?: number) =>
  ({
    send: vi.fn(async () => ({
      ok: false,
      error: "window",
      failure: { status: 400, platformCode, platformSubcode },
    })),
  }) as unknown as ZernioTransport;

const wa = {
  conversationId: "c",
  accountId: "a",
  platform: "whatsapp" as const,
  phone: "+77001112233",
};
const ig = { conversationId: "c", accountId: "a", platform: "instagram" as const };

beforeEach(() => {
  setEnvForTests({});
  alerts.length = 0;
  mailOn = false;
});
afterEach(() => setEnvForTests(undefined));

describe("выдача при закрытом окне 24 часа", () => {
  it("WhatsApp: ссылка на страницу заказа уходит одобренным шаблоном одной строкой", async () => {
    const start = vi.fn(async (_p: unknown) => ({ ok: true as const }));
    const d = await zernioDeliverySender(setup("order_update:ru"), wa, order, {
      transport: closedTransport(),
      start,
    });
    expect(d.pageUrl).toMatch(/^https:\/\/app\.test\/s\/shop\/order\/9\?t=[0-9a-f]{32}$/);
    expect(await d.send(item, mats)).toBe("sent");
    expect(start).toHaveBeenCalledTimes(1);
    const params = start.mock.calls[0]![0] as {
      templateName: string;
      templateLanguage: string;
      templateParams: string[];
      phone: string;
    };
    expect(params).toMatchObject({ templateName: "order_update", templateLanguage: "ru" });
    expect(params.templateParams).toEqual([`Заказ №109: файлы на странице ${d.pageUrl}`]);
    expect(params.templateParams[0]).not.toMatch(/\n/);
    expect(d.notes[0]).toMatch(/ушла шаблоном «order_update»/);
    expect(alerts[0]).toContain(d.pageUrl!.replace(/&/g, "&amp;"));
  });

  it("WhatsApp без шаблона: продавцу — причина и где задать шаблон", async () => {
    const start = vi.fn();
    const d = await zernioDeliverySender(setup(), wa, order, {
      transport: closedTransport(),
      start,
    });
    expect(await d.send(item, mats)).toBe("sent");
    expect(start).not.toHaveBeenCalled();
    expect(d.notes[0]).toMatch(/шаблон не задан \(Настройки → «Автоответчик · WhatsApp»/);
    expect(alerts).toHaveLength(1);
  });

  it("Instagram: шаблонов нет — копия письмом, если есть почта и настроен SMTP", async () => {
    mailOn = true;
    const d = await zernioDeliverySender(
      setup(),
      ig,
      { ...order, customer_email: "anna@mail.ru" },
      { transport: closedTransport(10, 2018278) },
    );
    expect(await d.send(item, mats)).toBe("sent");
    expect(d.notes[0]).toMatch(/^Instagram: .*Копия файлов уйдёт письмом на anna@mail\.ru/);

    mailOn = false;
    const noMail = await zernioDeliverySender(setup(), ig, order, {
      transport: closedTransport(10, 2018278),
    });
    await noMail.send(item, mats);
    expect(noMail.notes[0]).toMatch(/Почты покупателя нет/);
  });

  it("у магазина нет адреса — страницы нет, выдача не засчитывается", async () => {
    const ctx = setup();
    (ctx.tenant.settings as { slug?: string }).slug = undefined;
    const d = await zernioDeliverySender(ctx, wa, order, { transport: closedTransport() });
    expect(d.pageUrl).toBeNull();
    expect(await d.send(item, mats)).toBe("failed");
    expect(alerts).toEqual([]);
  });
});
