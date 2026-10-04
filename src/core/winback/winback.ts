import type { TenantContext } from "@/core/tenant/resolve.server";
import { recordAutoMessage, recordAutoSkip } from "@/core/automsg/stats";
import { IN_CHUNK, chunksOf } from "@/lib/in-chunks";
import {
  blockedAmong,
  claimStateSection,
  customerFromRow,
  type Customer,
} from "@/core/customers/customers";
import { lastInboundAt } from "@/core/chat/chat";
import { replyWindow } from "@/core/chat/reply-window";
import { getSetting, setSetting } from "@/core/settings/settings";
import { claimMarketing, loadMarketingCap } from "@/core/marketing/cap";
import { minutesInTz } from "@/core/notify/prefs";
import { eachPage, pageAll } from "@/core/db/page";
import { serverFailure } from "@/lib/server-failure";

/**
 * Возвратные продажи (модуль winback): покупателю, который давно не
 * заказывал, — серия из двух сообщений: через `days1` дней после последнего
 * заказа и, если он так и не вернулся, через `days2`. В тексте можно
 * подставить промокод `{promo}` и имя `{name}`. Прогресс серии — в
 * `bot_users.state.winback = {order_id, step}`: новый заказ сбрасывает
 * серию сам (другой order_id). Пишем только днём по поясу магазина и не
 * тем, чей последний заказ старше 180 дней, — это уже не «вернуть», а спам.
 */
export type WinbackConfig = {
  enabled: boolean;
  days1: number;
  text1: string;
  days2: number | null;
  text2: string;
  promo: string;
};

export const WINBACK_KEY = "winback";
export const WINBACK_MAX_AGE_DAYS = 180;
export const WINBACK_BATCH = 50;
const DAY = 86_400_000;

export function defaultWinback(): WinbackConfig {
  return {
    enabled: false,
    days1: 30,
    text1: "{name}, давно не виделись! Загляните в каталог — там новинки.",
    days2: 60,
    text2: "{name}, напоминаем о себе: для вас действует промокод {promo}.",
    promo: "",
  };
}

export function parseWinback(raw: string | null | undefined): WinbackConfig {
  const d = defaultWinback();
  if (!raw) return d;
  try {
    const p = JSON.parse(raw) as Partial<WinbackConfig>;
    const raw1 = Number(p.days1);
    const days1 = Number.isInteger(raw1) && raw1 >= 3 && raw1 <= 365 ? raw1 : d.days1;
    const raw2 = p.days2 == null ? null : Number(p.days2);
    return {
      enabled: p.enabled === true,
      days1,
      text1:
        typeof p.text1 === "string" && p.text1.trim() ? p.text1.trim().slice(0, 1000) : d.text1,
      days2: raw2 != null && Number.isInteger(raw2) && raw2 > days1 && raw2 <= 365 ? raw2 : null,
      text2:
        typeof p.text2 === "string" && p.text2.trim() ? p.text2.trim().slice(0, 1000) : d.text2,
      promo: typeof p.promo === "string" ? p.promo.trim().toUpperCase().slice(0, 40) : "",
    };
  } catch {
    return d;
  }
}

export type WinbackMemory = { order_id?: number; step?: number };

/** Какой шаг серии положен сейчас: 0 — ничего, 1 — первое, 2 — второе. */
export function winbackStep(
  cfg: WinbackConfig,
  lastOrder: { id: number; at: string },
  memory: WinbackMemory | undefined,
  now: Date,
): 0 | 1 | 2 {
  const age = (now.getTime() - Date.parse(lastOrder.at)) / DAY;
  if (age > WINBACK_MAX_AGE_DAYS) return 0;
  const done = memory?.order_id === lastOrder.id ? (memory.step ?? 0) : 0;
  if (done < 1 && age >= cfg.days1) return 1;
  if (done < 2 && cfg.days2 != null && age >= cfg.days2) return 2;
  return 0;
}

/** Текст шага с подстановками; без промокода строка с {promo} убирается целиком. */
export function winbackText(cfg: WinbackConfig, step: 1 | 2, name: string | null): string {
  const raw = step === 1 ? cfg.text1 : cfg.text2;
  const lines = raw
    .split("\n")
    .filter((l) => cfg.promo || !l.includes("{promo}"))
    .join("\n");
  return lines
    .replaceAll("{name}", name?.trim() || "Здравствуйте")
    .replaceAll("{promo}", cfg.promo)
    .trim();
}

/** Днём по поясу магазина: с 10:00 до 20:00. */
export function daytime(now: Date, tz: string): boolean {
  const m = minutesInTz(now, tz);
  return m >= 10 * 60 && m < 20 * 60;
}

export async function loadWinback(ctx: TenantContext): Promise<WinbackConfig> {
  return parseWinback(await getSetting(ctx, WINBACK_KEY));
}

export async function saveWinback(ctx: TenantContext, cfg: WinbackConfig): Promise<void> {
  await setSetting(ctx, WINBACK_KEY, JSON.stringify(cfg));
}

export type WinbackSender = (customer: Customer, text: string) => Promise<boolean>;

const DONE_STATUSES = ["delivered", "paid", "accepted", "in_production", "ready"];

/** Заказ ещё не закрыт: ждёт оплаты, в работе или в доставке. Такой покупатель уже вернулся. */
const OPEN_STATUSES = [
  "awaiting_payment",
  "awaiting_confirmation",
  "paid",
  "accepted",
  "in_production",
  "ready",
  "delivering",
];

/** Корзина, тронутая за последние сутки, — у покупателя своё напоминание о корзине. */
const CART_FRESH_MS = DAY;

/**
 * Кто из этих покупателей «уже вернулся»: есть открытый заказ (с `since`) или
 * корзина, тронутая за последние сутки. Читается постранично кусками по 200
 * id; не прочиталось — `serverFailure`: молча писать вернувшемуся нельзя.
 */
export async function alreadyBack(
  ctx: TenantContext,
  telegramIds: readonly number[],
  since: string,
  now: Date,
): Promise<Set<number>> {
  const back = new Set<number>();
  const cartSince = new Date(now.getTime() - CART_FRESH_MS).toISOString();
  for (const chunk of chunksOf(telegramIds, IN_CHUNK)) {
    const open = await pageAll(
      (from, to) =>
        ctx.db
          .from("orders")
          .select("id, telegram_id")
          .in("telegram_id", chunk)
          .in("status", OPEN_STATUSES)
          .gte("created_at", since)
          .order("id")
          .range(from, to),
      "возврат клиентов: открытые заказы",
    );
    for (const o of open) back.add(Number(o.telegram_id));
    const carts = await pageAll(
      (from, to) =>
        ctx.db
          .from("cart_items")
          .select("id, telegram_id")
          .in("telegram_id", chunk)
          .gte("created_at", cartSince)
          .order("id")
          .range(from, to),
      "возврат клиентов: свежие корзины",
    );
    for (const c of carts) back.add(Number(c.telegram_id));
  }
  return back;
}

/** Один проход по арендатору: не больше WINBACK_BATCH сообщений. */
export async function runWinback(
  ctx: TenantContext,
  send: WinbackSender,
  now = new Date(),
): Promise<{
  checked: number;
  sent: number;
  failed: number;
  /** Не писали: у покупателя открытый заказ или свежая корзина. */
  returned: number;
  skipped?: string;
}> {
  const r = { checked: 0, sent: 0, failed: 0, returned: 0 };
  if (!ctx.tenant.modules.winback) return { ...r, skipped: "module off" };
  const cfg = await loadWinback(ctx);
  if (!cfg.enabled) return { ...r, skipped: "disabled" };
  if (!daytime(now, ctx.timezone)) return { ...r, skipped: "night" };
  const cap = await loadMarketingCap(ctx);
  const since = new Date(now.getTime() - WINBACK_MAX_AGE_DAYS * DAY).toISOString();
  // Все заказы окна, постранично (в 180 днях у крупного магазина больше
  // 5000 заказов); в памяти — только последний заказ каждого покупателя.
  const last = new Map<number, { id: number; at: string }>();
  await eachPage(
    (from, to) =>
      ctx.db
        .from("orders")
        .select("id, telegram_id, created_at")
        .in("status", DONE_STATUSES)
        .gte("created_at", since)
        .order("id")
        .range(from, to),
    "возврат клиентов: заказы",
    (orders) => {
      for (const o of orders) {
        const tg = Number(o.telegram_id);
        const prev = last.get(tg);
        if (!prev || o.created_at > prev.at) last.set(tg, { id: o.id, at: o.created_at });
      }
    },
  );
  const due = [...last.entries()]
    .filter(([, o]) => (now.getTime() - Date.parse(o.at)) / DAY >= cfg.days1)
    .map(([id]) => id);
  if (!due.length) return r;
  // Покупатели кусками по 200 id (длина адреса и потолок 1000 строк), пока
  // не набрана пачка отправок.
  for (let i = 0; i < due.length && r.sent + r.failed < WINBACK_BATCH; i += 200) {
    const { data: users, error } = await ctx.db
      .from("bot_users")
      .select("*")
      .in("telegram_id", due.slice(i, i + 200));
    if (error) throw serverFailure(`возврат клиентов: покупатели: ${error.message}`);
    const blocked = await blockedAmong(
      ctx,
      (users ?? []).map((u) => Number(u.telegram_id)),
    );
    const back = await alreadyBack(
      ctx,
      (users ?? []).map((u) => Number(u.telegram_id)),
      since,
      now,
    );
    for (const row of users ?? []) {
      if (r.sent + r.failed >= WINBACK_BATCH) break;
      // Отписавшийся от рассылок не получает и этих сообщений (core/customers/opt-out).
      if (row.opt_out) continue;
      const c = customerFromRow(row);
      const order = last.get(c.telegramId);
      if (!order) continue;
      r.checked++;
      const mem = (c.state.winback ?? undefined) as WinbackMemory | undefined;
      const step = winbackStep(cfg, order, mem, now);
      if (!step || blocked.has(c.telegramId)) continue;
      // Уже вернулся (открытый заказ, свежая корзина): не пишем и потолок не тратим.
      if (back.has(c.telegramId)) {
        r.returned++;
        await recordAutoSkip(ctx, "winback", c.telegramId, `${order.id}:${step}`, now);
        continue;
      }
      // Instagram и WhatsApp: Meta пропускает ответ только в окне 24 часа от
      // последнего входящего. Окно закрыто — шаг серии и место в потолке не
      // тратим (напишем, когда покупатель ответит), в итогах это «пропуск».
      if (c.platform === "instagram" || c.platform === "whatsapp") {
        let open = false;
        try {
          open =
            replyWindow(c.platform, await lastInboundAt(ctx, c.telegramId), now.getTime())
              ?.state === "open";
        } catch (e) {
          console.error(`[winback:${ctx.tenant.id}] ${c.telegramId}`, e);
          continue;
        }
        if (!open) {
          await recordAutoSkip(ctx, "winback", c.telegramId, `${order.id}:${step}:window`, now);
          continue;
        }
      }
      // Потолок маркетинговых сообщений за сутки (core/marketing/cap): место
      // занято — шаг не отмечаем, напишем в следующий прогон.
      const marked = await claimMarketing(ctx, c.userKey, row.state, cap, now);
      if (!marked) continue;
      const ok = await send(c, winbackText(cfg, step, c.firstName)).catch(() => false);
      if (ok) r.sent++;
      else r.failed++;
      await recordAutoMessage(ctx, "winback", c.telegramId, ok, now);
      // Шаг отмечаем и при неудаче: не долбить одного и того же каждый час.
      // Пишем только раздел winback на свежем state с условием на его rev и
      // state.mode: параллельные записи бота и v1 не затираем.
      await claimStateSection(ctx, c, "winback", () => ({
        order_id: order.id,
        step,
        at: now.toISOString(),
      }));
    }
  }
  return r;
}
