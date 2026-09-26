import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT } from "./live";
import { serviceDb } from "@/core/db/client.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import {
  getCustomer,
  setState,
  syntheticTelegramId,
  upsertCustomer,
  userKey,
} from "@/core/customers/customers";
import { deliverOrder, getOrder } from "@/core/orders/orders";
import { handleZernioMessage } from "@/channels/zernio/handle-message";
import { zernioMaterialSender } from "@/channels/zernio/deliver";
import type { ZernioTransport } from "@/channels/zernio/api.server";
import { getSettings, setSetting } from "@/core/settings/settings";
import { directBotSettingKeys } from "@/core/instagram/direct-bot-settings";

/**
 * Магазин в Direct на демо-клиенте: каталог → карточка → корзина →
 * оформление → страна → заказ → чек → выдача ссылкой. Zernio подменён,
 * всё остальное — настоящая база под ключом арендатора.
 */
const SENDER = "990000777003";
const NEW_SENDER = "990000777013"; // первый контакт — выбор языка
const LOST_SENDER = "990000777014"; // не понимает выбор языка
const KEY = userKey("instagram", SENDER);
const TG = syntheticTelegramId(KEY);
const PROBE_NAME = "v2 direct · материал";
const COUNTRY_NAME = "Казахстан (v2 direct)";
let ctx: TenantContext;
let productId = "";
let orderId = 0;
const sent: Array<{ text: string; buttons?: string[]; attachment?: string }> = [];
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 1, 2, 3]);
const fake: ZernioTransport = {
  send: async (_c, _a, text, opts) => {
    sent.push({
      text,
      buttons: opts?.buttons?.map((b) => b.title),
      attachment: opts?.attachmentUrl,
    });
    return { ok: true };
  },
  tail: async () => [],
  download: async () => ({ bytes: PNG, mime: "image/png" }),
};
const last = () => sent[sent.length - 1]!;
let prevBot: Record<string, string> = {};

function event(id: string, body: Record<string, unknown>) {
  return {
    id,
    event: "message.received",
    account: { accountId: "acc-demo", platform: "instagram" },
    message: {
      conversationId: "conv-shop",
      sender: { id: SENDER, name: "Проба Магазин", username: "probe_shop" },
      direction: "incoming",
      ...body,
    },
  };
}
const text = (id: string, t: string) => event(id, { text: t });
const tap = (id: string, payload: string) => ({
  ...event(id, { text: null }),
  metadata: { postbackPayload: payload },
});

async function cleanup() {
  const db = serviceDb();
  if (orderId) {
    const { data: files } = await db.storage
      .from("payment-proofs")
      .list(`${DEMO_BOT}/order-${orderId}`);
    if (files?.length)
      await db.storage
        .from("payment-proofs")
        .remove(files.map((f) => `${DEMO_BOT}/order-${orderId}/${f.name}`));
    await db.from("orders").delete().eq("id", orderId);
  }
  await db.from("cart_items").delete().eq("bot_id", DEMO_BOT).eq("telegram_id", TG);
  await db
    .from("bot_users")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .in("user_key", [KEY, userKey("instagram", NEW_SENDER), userKey("instagram", LOST_SENDER)]);
  await db.from("products").delete().eq("bot_id", DEMO_BOT).eq("name", PROBE_NAME);
  await db.from("payment_methods").delete().eq("bot_id", DEMO_BOT).eq("country_name", COUNTRY_NAME);
}

describe.skipIf(!liveReady)("магазин в Instagram Direct на демо-клиенте", () => {
  beforeAll(async () => {
    const tenant = await requireTenant({ by: "id", value: DEMO_BOT });
    ctx = tenantContext({
      ...tenant,
      modules: {
        ...tenant.modules,
        instagram: true,
        dm_shop: true,
        manager_chat: false,
        stock: false,
      },
    });
    await cleanup();
    // На демо-клиенте лежат настройки автоответчика из v1 — тест идёт на значениях по умолчанию.
    prevBot = await getSettings(ctx, directBotSettingKeys("instagram"));
    for (const k of directBotSettingKeys("instagram")) await setSetting(ctx, k, "");
    const { data: p, error } = await ctx.db
      .from("products")
      .insert({
        bot_id: DEMO_BOT,
        name: PROBE_NAME,
        description: "тест Direct v2",
        price: 1500,
        currency: "KZT",
        is_active: true,
        fulfillment_kind: "digital",
        category_ids: [],
        country_prices: {},
        file_url: "https://example.com/material.pdf",
      })
      .select("id")
      .single();
    if (error || !p) throw new Error(`seed product: ${error?.message}`);
    productId = p.id;
    const { error: mErr } = await ctx.db.from("payment_methods").insert({
      bot_id: DEMO_BOT,
      country_code: "KZ",
      country_name: COUNTRY_NAME,
      instructions: "Kaspi: тестовые реквизиты Direct",
      currency: "KZT",
      is_active: true,
      sort_order: 99,
    });
    if (mErr) throw new Error(`seed method: ${mErr.message}`);
    // Основной покупатель уже выбирал язык — иначе первым ответом был бы выбор языка.
    const seeded = await upsertCustomer(ctx, "instagram", SENDER, { firstName: "Проба Магазин" });
    await setState(ctx, seeded, { locale: "ru", locale_picked_at: new Date().toISOString() });
  });
  afterAll(async () => {
    for (const k of directBotSettingKeys("instagram")) await setSetting(ctx, k, prevBot[k] ?? "");
    await cleanup();
  });

  it("карточка по кнопке: название, цена и «В корзину»", async () => {
    const r = await handleZernioMessage(ctx, tap("d-1", `PROD:${productId}`), fake);
    expect(r.status).toBe("processed");
    expect(last().text).toContain(PROBE_NAME);
    expect(last().text).toContain("1500");
    expect(last().buttons?.some((b) => /корзин/i.test(b))).toBe(true);
  });

  it("покупка кладёт в корзину и показывает итог; повтор того же меню подавляется", async () => {
    await handleZernioMessage(ctx, tap("d-2", `BUY:${productId}`), fake);
    expect(last().text).toContain("Итого");
    expect(last().text).toContain(PROBE_NAME);
    const before = sent.length;
    // Один и тот же ответ подряд («не найден») не уходит второй раз; явная
    // команда «корзина» — осознанный повтор, и она уходит всегда.
    await handleZernioMessage(ctx, text("d-3", "99999"), fake);
    await handleZernioMessage(ctx, text("d-4", "99999"), fake);
    expect(sent.length).toBe(before + 1);
    await handleZernioMessage(ctx, text("d-4b", "корзина"), fake);
    expect(sent.length).toBe(before + 2);
  });

  it("оформление: страна номером из списка → заказ с реквизитами и ожидание чека", async () => {
    await handleZernioMessage(ctx, tap("d-5", "CHECKOUT"), fake);
    expect(last().text).toMatch(/стран/i);
    const line = last()
      .text.split("\n")
      .find((l) => l.includes(COUNTRY_NAME))!;
    expect(line).toBeTruthy();
    const ordinal = line.match(/^(\d+)\./)![1];
    await handleZernioMessage(ctx, text("d-6", ordinal!), fake);
    const instructions = sent.find((m) => m.text.includes("тестовые реквизиты Direct"));
    expect(instructions).toBeTruthy();
    expect(instructions!.text).toMatch(/Заказ #\d+/);
    expect(instructions!.text).not.toContain("<b>");
    const c = await getCustomer(ctx, KEY);
    expect(c?.state.mode).toBe("awaiting_proof");
    orderId = Number(c?.state.pending_order_id);
    expect(orderId).toBeGreaterThan(0);
    const order = await getOrder(ctx, orderId);
    expect(order?.platform).toBe("instagram");
    expect(order?.user_key).toBe(KEY);
    expect(order?.status).toBe("awaiting_payment");
  });

  it("вопрос на шаге оплаты уходит человеку, а не глотается сценарием", async () => {
    const before = sent.length;
    const r = await handleZernioMessage(ctx, text("d-7", "а можно оплатить завтра?"), fake);
    expect(r.status).toBe("processed");
    const fresh = sent.slice(before).map((m) => m.text);
    expect(fresh.some((t) => /чек/i.test(t))).toBe(true);
    expect(fresh.some((t) => /Передал ваш вопрос продавцу/.test(t))).toBe(true);
  });

  it("чек картинкой: заказ переходит на проверку, покупатель получает подтверждение", async () => {
    await handleZernioMessage(
      ctx,
      event("d-8", {
        text: null,
        attachments: [{ type: "image", url: "https://cdn.test/receipt.png" }],
      }),
      fake,
    );
    expect(last().text).toMatch(/Чек по заказу #\d+ получен/);
    const order = await getOrder(ctx, orderId);
    expect(order?.status).toBe("awaiting_confirmation");
    expect(order?.payment_proof_path).toContain(`order-${orderId}`);
    expect((await getCustomer(ctx, KEY))?.state.mode).toBe("idle");
  });

  it("выдача ссылкой через Zernio", async () => {
    const r = await deliverOrder(
      ctx,
      orderId,
      zernioMaterialSender(fake, "conv-shop", "acc-demo", "instagram"),
    );
    expect(r.failed).toBe(0);
    expect(r.sent).toBe(1);
    expect(last().text).toContain("https://example.com/material.pdf");
    expect((await getOrder(ctx, orderId))?.status).toBe("delivered");
    await handleZernioMessage(ctx, text("d-9", "мои заказы"), fake);
    expect(last().text).toContain(`#`);
    expect(last().text).toContain(PROBE_NAME);
  });

  it("голосовое вне шага оплаты не считается чеком и не ломает диалог", async () => {
    const r = await handleZernioMessage(
      ctx,
      event("d-10", {
        text: null,
        attachments: [{ type: "audio", url: "https://cdn.test/voice.mp4" }],
      }),
      fake,
    );
    expect(["processed", "ignored"]).toContain(r.status);
  });

  it("первый контакт: выбор языка на четырёх языках, ответ номером — каталог на выбранном", async () => {
    const ev = (id: string, t: string) => ({
      ...text(id, t),
      message: {
        ...text(id, t).message,
        sender: { id: NEW_SENDER, name: "Новый", username: "new_probe" },
      },
    });
    const r = await handleZernioMessage(ctx, ev("n-1", "Здравствуйте!"), fake);
    expect(r.status).toBe("processed");
    expect(last().text).toContain("Выберите язык / Тілді таңдаңыз");
    expect(last().text).toContain("Choose language");
    await handleZernioMessage(ctx, ev("n-2", "3"), fake);
    const c = await getCustomer(ctx, userKey("instagram", NEW_SENDER));
    expect(c?.state.locale).toBe("en");
    expect(c?.state.mode).toBe("idle");
    expect(sent.slice(-2)[0]!.text).toMatch(/English|language/i);
    // Второй раз не спрашиваем.
    const before = sent.length;
    await handleZernioMessage(ctx, ev("n-3", "catalog"), fake);
    expect(sent.slice(before).some((m) => /Choose language/.test(m.text))).toBe(false);
  });

  it("первый контакт: не понял дважды — отвечаем на языке магазина и показываем каталог", async () => {
    const ev = (id: string, t: string) => ({
      ...text(id, t),
      message: {
        ...text(id, t).message,
        sender: { id: LOST_SENDER, name: "Потерялся", username: "lost_probe" },
      },
    });
    await handleZernioMessage(ctx, ev("l-1", "привет"), fake);
    expect(last().text).toContain("Выберите язык");
    await handleZernioMessage(ctx, ev("l-2", "что?"), fake);
    expect(last().text).toContain("Выберите язык");
    await handleZernioMessage(ctx, ev("l-3", "не понимаю"), fake);
    expect(last().text).not.toContain("Выберите язык");
    const c = await getCustomer(ctx, userKey("instagram", LOST_SENDER));
    expect(c?.state.locale).toBe("ru");
    expect(c?.state.mode).toBe("idle");
  });

  it("настройки автоответчика: своё слово-вызов открывает каталог, выключенный бот молчит", async () => {
    const keys = directBotSettingKeys("instagram");
    const triggersKey = keys.find((k) => k.endsWith("_triggers"))!;
    const enabledKey = keys.find((k) => k.endsWith("_enabled"))!;
    await setSetting(ctx, triggersKey, "прайс, хочу купить");
    const before = sent.length;
    const r1 = await handleZernioMessage(ctx, text("s-1", "Прайс!"), fake);
    expect(r1.status).toBe("processed");
    expect(sent.length).toBeGreaterThan(before);
    expect(last().text).toMatch(/категори|каталог|товар/i);

    await setSetting(ctx, enabledKey, "false");
    const before2 = sent.length;
    const r2 = await handleZernioMessage(ctx, text("s-2", "каталог"), fake);
    expect(r2.note).toContain("выключен");
    expect(sent.length).toBe(before2);
    await setSetting(ctx, enabledKey, "");
    await setSetting(ctx, triggersKey, "");
  });
});
