import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT, TEST_TG_ID } from "./live";
import { serviceDb } from "@/core/db/client.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { getSettings, setSetting } from "@/core/settings/settings";
import { activeSubscription, getSubscription, saveTariff, VIP_SETTING_KEYS } from "@/core/vip/vip";
import { runVipCron } from "@/core/vip/cron";
import { handleVipUpdate } from "@/channels/telegram/vip/handle";
import { vipGroupApi } from "@/channels/telegram/vip/group";
import type { TelegramApi } from "@/channels/telegram/api";

/**
 * VIP-бот целиком, как его видит покупатель и продавец, перед переездом
 * школ с VIP-группой: /start → язык → «первый вход» → чек → продавец
 * подтверждает → ссылка в группу → продление из группы со стыковкой срока →
 * напоминание крона → истечение и исключение. Telegram подменён (группа —
 * флаг «в группе»), база настоящая; пишет только в «Демо-тестер» и
 * возвращает его настройки и тарифы как были.
 */
const BUYER = TEST_TG_ID + 72;
const SELLER = TEST_TG_ID + 73;
const GROUP = "-1000000000778";
const PREFIX = "v2 vip bot ·";

let ctx: TenantContext;
let prevSettings: Record<string, string> = {};
let prevEntry: string[] = [];
let entryId = "";
let monthId = "";
let inGroup = false;

type Call = [string, Record<string, unknown>];
const calls: Call[] = [];
// Чек — настоящий JPEG по первым байтам: attachPaymentProof проверяет содержимое.
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(64)]);
let receipt = jpeg();
const api: TelegramApi = {
  call: async (method: string, payload: unknown = {}) => {
    const p = payload as Record<string, unknown>;
    calls.push([method, p]);
    if (method === "getFile") return { ok: true, result: { file_path: "photos/receipt.jpg" } };
    if (method === "getChatMember")
      return {
        ok: true,
        result: { status: inGroup ? "member" : "left", user: { id: p.user_id } },
      } as never;
    if (method === "createChatInviteLink")
      return { ok: true, result: { invite_link: `https://t.me/+${String(p.name)}` } } as never;
    if (method === "banChatMember") inGroup = false;
    return { ok: true, result: { message_id: calls.length } as never };
  },
  fileUrl: () => `data:image/jpeg;base64,${receipt.toString("base64")}`,
} as unknown as TelegramApi;

let seq = 0;
const from = (id: number) => ({ id, first_name: "Участник", username: "vip_probe" });
const say = (text: string) =>
  handleVipUpdate(ctx, api, {
    update_id: ++seq,
    message: { message_id: seq, chat: { id: BUYER, type: "private" }, from: from(BUYER), text },
  } as never);
const photo = () =>
  handleVipUpdate(ctx, api, {
    update_id: ++seq,
    message: {
      message_id: seq,
      chat: { id: BUYER, type: "private" },
      from: from(BUYER),
      photo: [{ file_id: `receipt-${seq}` }],
    },
  } as never);
const press = (data: string, who = BUYER) =>
  handleVipUpdate(ctx, api, {
    update_id: ++seq,
    callback_query: {
      id: `cq-${seq}`,
      from: from(who),
      message: { message_id: seq, chat: { id: who, type: "private" } },
      data,
    },
  } as never);

const textsTo = (chat: number, since = 0) =>
  calls
    .slice(since)
    .filter(([, p]) => String(p.chat_id) === String(chat))
    .map(([, p]) => String(p.text ?? p.caption ?? ""));

/** Последняя кнопка в сообщениях этому чату, чей callback_data подходит под образец. */
function button(re: RegExp, chat = BUYER): string | null {
  for (let i = calls.length - 1; i >= 0; i--) {
    const [, p] = calls[i]!;
    if (String(p.chat_id) !== String(chat)) continue;
    const kb = (p.reply_markup as { inline_keyboard?: Array<Array<{ callback_data?: string }>> })
      ?.inline_keyboard;
    const hit = kb?.flat().find((b) => b.callback_data && re.test(b.callback_data));
    if (hit) return hit.callback_data!;
  }
  return null;
}

async function cleanup() {
  const db = serviceDb();
  const { data: subs } = await db
    .from("vip_subscriptions")
    .select("id")
    .eq("bot_id", DEMO_BOT)
    .eq("telegram_id", BUYER);
  for (const { id } of subs ?? []) {
    const { data: files } = await db.storage.from("payment-proofs").list(`${DEMO_BOT}/vip-${id}`);
    if (files?.length)
      await db.storage
        .from("payment-proofs")
        .remove(files.map((f) => `${DEMO_BOT}/vip-${id}/${f.name}`));
  }
  await db.from("vip_subscriptions").delete().eq("bot_id", DEMO_BOT).eq("telegram_id", BUYER);
  await db.from("vip_member_profiles").delete().eq("bot_id", DEMO_BOT).eq("telegram_id", BUYER);
  await db.from("vip_tariffs").delete().eq("bot_id", DEMO_BOT).like("name", `${PREFIX}%`);
}

describe.skipIf(!liveReady)("VIP-бот на демо-клиенте: покупка, доступ, продление", () => {
  beforeAll(async () => {
    const t = await requireTenant({ by: "id", value: DEMO_BOT });
    ctx = tenantContext({
      ...t,
      status: "active",
      ownerTelegramId: null,
      modules: { ...t.modules, vip: true },
    } as never);
    await cleanup();
    prevSettings = await getSettings(ctx, [...VIP_SETTING_KEYS, "admin_chat_id"]);
    // «Первый вход» у клиента один: сохраняем свой — флаг с чужих снимется, вернём после.
    const { data: entries } = await serviceDb()
      .from("vip_tariffs")
      .select("id")
      .eq("bot_id", DEMO_BOT)
      .eq("is_entry", true);
    prevEntry = (entries ?? []).map((e) => e.id);

    await setSetting(ctx, "admin_chat_id", String(SELLER));
    await setSetting(ctx, "vip_group_id", GROUP);
    await setSetting(ctx, "vip_test_mode", "false");
    await setSetting(ctx, "vip_payment_qr_path", "");
    await setSetting(ctx, "vip_payment_instructions", "Kaspi: реквизиты пробы VIP");
    await setSetting(ctx, "vip_welcome_message", "Добро пожаловать в клуб");
    entryId = await saveTariff(ctx, {
      name: `${PREFIX} первый вход`,
      price: 990,
      currency: "KZT",
      duration_days: 7,
      is_active: true,
      is_public: false,
      is_entry: true,
      sort_order: 0,
    });
    monthId = await saveTariff(ctx, {
      name: `${PREFIX} месяц`,
      price: 5000,
      currency: "KZT",
      duration_days: 30,
      is_active: true,
      is_public: true,
      is_entry: false,
      sort_order: 0,
    });
  });
  afterAll(async () => {
    // Ключа не было — удаляем строку, а не оставляем пустую: демо-клиент как был.
    for (const k of [...VIP_SETTING_KEYS, "admin_chat_id"]) {
      if (k in prevSettings) await setSetting(ctx, k, prevSettings[k]!);
      else await serviceDb().from("app_settings").delete().eq("bot_id", DEMO_BOT).eq("key", k);
    }
    await cleanup();
    if (prevEntry.length)
      await serviceDb().from("vip_tariffs").update({ is_entry: true }).in("id", prevEntry);
  });

  it("новый участник: язык, «первый вход», чек, подтверждение продавцом, ссылка в группу", async () => {
    await say("/start");
    expect(button(/^vip_locale:ru$/)).toBe("vip_locale:ru");
    expect(button(/^buy_tariff:/)).toBe(`buy_tariff:${entryId}`);
    await press("vip_locale:ru");

    await press(`buy_tariff:${entryId}`);
    expect(textsTo(BUYER).some((t) => t.includes("реквизиты пробы VIP"))).toBe(true);

    await photo();
    const pending = await serviceDb()
      .from("vip_subscriptions")
      .select("id, status, payment_proof_path")
      .eq("bot_id", DEMO_BOT)
      .eq("telegram_id", BUYER)
      .single();
    expect(pending.data?.status).toBe("pending_payment");
    expect(pending.data?.payment_proof_path).toContain(`vip-${pending.data!.id}/`);
    const confirm = button(/^vip_confirm:/, SELLER);
    expect(confirm).toBe(`vip_confirm:${pending.data!.id}`);

    // Не продавец подтвердить не может.
    const before = calls.length;
    await press(confirm!, BUYER);
    expect(textsTo(BUYER, before).some((t) => t.includes("Только администратор"))).toBe(true);
    expect((await getSubscription(ctx, pending.data!.id))?.status).toBe("pending_payment");

    await press(confirm!, SELLER);
    const active = await activeSubscription(ctx, BUYER);
    expect(active?.id).toBe(pending.data!.id);
    const days = (new Date(active!.expires_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    expect(textsTo(BUYER).some((t) => t.includes("https://t.me/+vip-"))).toBe(true);
    expect(textsTo(SELLER).some((t) => t.includes("Подписка подтверждена"))).toBe(true);
    expect(calls.some(([m, p]) => m === "editMessageReplyMarkup" && p.chat_id === SELLER)).toBe(
      true,
    );

    // Повторное нажатие не активирует второй раз.
    const again = calls.length;
    await press(confirm!, SELLER);
    expect(textsTo(SELLER, again).join("\n")).toMatch(/уже активна/);
  });

  it("продление из группы: «первый вход» второй раз не продаётся, срок стыкуется, новой ссылки нет", async () => {
    inGroup = true;
    const first = (await activeSubscription(ctx, BUYER))!;

    await press(`buy_tariff:${entryId}`);
    expect(
      await serviceDb()
        .from("vip_subscriptions")
        .select("id")
        .eq("bot_id", DEMO_BOT)
        .eq("telegram_id", BUYER)
        .eq("status", "pending_payment"),
    ).toMatchObject({ data: [] });

    const mark = calls.length;
    await say("/start renew");
    expect(button(/^buy_tariff:/)).not.toBeNull();
    expect(
      calls
        .slice(mark)
        .some(([, p]) => JSON.stringify(p.reply_markup ?? {}).includes(`buy_tariff:${monthId}`)),
    ).toBe(true);

    await press(`buy_tariff:${monthId}`);
    receipt = jpeg();
    await photo();
    const invitesBefore = calls.filter(([m]) => m === "createChatInviteLink").length;
    await press(button(/^vip_confirm:/, SELLER)!, SELLER);

    const renewed = (await activeSubscription(ctx, BUYER))!;
    expect(renewed.id).not.toBe(first.id);
    const expected = new Date(first.expires_at).getTime() + 30 * 86_400_000;
    expect(Math.abs(new Date(renewed.expires_at).getTime() - expected)).toBeLessThan(5_000);
    expect((await getSubscription(ctx, first.id))?.status).toBe("expired");
    expect(calls.filter(([m]) => m === "createChatInviteLink").length).toBe(invitesBefore);

    const st = calls.length;
    await say("/status");
    expect(textsTo(BUYER, st).join("\n")).toContain(`${PREFIX} месяц`);
  });

  it("крон: напоминание со ссылкой на продление, после срока — исключение из группы", async () => {
    const sub = (await activeSubscription(ctx, BUYER))!;
    await serviceDb()
      .from("vip_subscriptions")
      .update({ expires_at: new Date(Date.now() + 2 * 86_400_000).toISOString() })
      .eq("id", sub.id);
    const mark = calls.length;
    const warned = await runVipCron(ctx, vipGroupApi(api), "demo_vip_bot");
    // У демо-клиента могут быть и свои участники — смотрим только на нашего.
    expect(warned.warned).toBeGreaterThanOrEqual(1);
    expect(warned.errors.filter((e) => e.includes(String(BUYER)))).toEqual([]);
    expect(textsTo(BUYER, mark).join("\n")).toContain("t.me/demo_vip_bot?start=renew");

    await serviceDb()
      .from("vip_subscriptions")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", sub.id);
    const r = await runVipCron(ctx, vipGroupApi(api), "demo_vip_bot");
    expect(r.expired).toBeGreaterThanOrEqual(1);
    expect(r.errors.filter((e) => e.includes(String(BUYER)))).toEqual([]);
    expect(calls.some(([m, p]) => m === "banChatMember" && p.user_id === BUYER)).toBe(true);
    expect(calls.some(([m, p]) => m === "unbanChatMember" && p.user_id === BUYER)).toBe(true);
    expect(inGroup).toBe(false);
    expect((await getSubscription(ctx, sub.id))?.status).toBe("expired");
    expect(await activeSubscription(ctx, BUYER)).toBeNull();
  });
});
