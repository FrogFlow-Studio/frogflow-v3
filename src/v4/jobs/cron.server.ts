import type { TelegramApi } from "@/channels/telegram/api";
import type { sendInboxMessage } from "@/channels/zernio/api.server";
import type { DeliveryChannel } from "../core/access/access";
import { tick, type QueuedNotification, type SendOutcome } from "../core/cases/cases";
import type { V4Db } from "../core/db";
import { v4BuyerSender, v4SellerTarget } from "../channels/senders.server";
import type { SellerLang } from "../screens/screens";
import { deliverHandler } from "./deliver";
import { runNotifications, type NotifyTarget } from "./notify";
import { runJobs } from "./runner";

/**
 * Крон v4: шаг планировщика, задания (выдача) и уведомления — только для
 * магазинов, которые обслуживает v4 (settings.served_by = "v4"). Чужие
 * задания и уведомления не берутся вовсе (migrations/v4/016): у магазина,
 * скопированного в v4, но не переключённого, ничего никуда не уходит.
 * Магазинов v4 нет — крон ничего не делает и в базу не ходит.
 */

export const V4_CRON_JOBS = ["tick", "jobs", "notify-now", "notify-digest"] as const;
export type V4CronJob = (typeof V4_CRON_JOBS)[number];
export const isV4CronJob = (j: string): j is V4CronJob =>
  (V4_CRON_JOBS as readonly string[]).includes(j);

/** Магазин v4 с тем, чем ему писать. */
export type V4Shop = {
  botId: string;
  telegram: TelegramApi | null;
  /** Единственный аккаунт Zernio на площадке (если у покупателя свой не записан). */
  zernio: { instagram: string | null; whatsapp: string | null };
  sellerChatIds: readonly string[];
  sellerLang: SellerLang;
};

export type V4CronDeps = {
  db: V4Db;
  /** Только магазины с served_by = "v4". Загружаются лениво: tick их не требует. */
  shops: () => Promise<V4Shop[]>;
  botIds: readonly string[];
  appUrl: string;
  /** Чат оператора платформы; null — не настроен. */
  operator: ((text: string) => Promise<SendOutcome>) | null;
  sendInbox?: typeof sendInboxMessage;
  budgetMs?: number;
  now?: () => number;
};

const LANGS = ["ru", "kk", "en", "uz"] as const;
const langOf = (v: unknown): SellerLang => LANGS.find((l) => l === v) ?? "ru";

function senderOf(shop: V4Shop, deps: V4CronDeps) {
  return v4BuyerSender({
    telegram: shop.telegram,
    zernioAccount: shop.zernio,
    sendInbox: deps.sendInbox,
  });
}

export async function runV4Cron(
  job: V4CronJob,
  deps: V4CronDeps,
): Promise<Record<string, unknown>> {
  if (!deps.botIds.length) return { shops: 0 };
  const base = deps.appUrl.replace(/\/+$/, "");
  if (job === "tick") return { shops: deps.botIds.length, ...(await tick(deps.db)) };

  const shops = new Map((await deps.shops()).map((s) => [s.botId, s]));
  if (job === "jobs") {
    const handler = (botId: string | null) => {
      const shop = botId ? shops.get(botId) : undefined;
      return deliverHandler({
        db: deps.db,
        // Магазина нет в списке v4 — сюда не попадём (фильтр в claim_jobs); на всякий
        // случай «не отправлено», а не «могло дойти».
        send: shop ? senderOf(shop, deps) : async () => "failed",
        cabinetUrl: (bot, token) => `${base}/c/${bot}/${token}`,
        now: deps.now,
      });
    };
    const report = await runJobs(
      deps.db,
      { deliver: (j, signal) => handler(j.botId)(j, signal) },
      { botIds: deps.botIds, budgetMs: deps.budgetMs, now: deps.now },
    );
    return { shops: shops.size, ...report };
  }

  const resolve = async (n: QueuedNotification): Promise<NotifyTarget | null> => {
    const shop = shops.get(n.botId);
    if (!shop) return null;
    if (n.audience === "seller")
      return v4SellerTarget({
        telegram: shop.telegram,
        chatIds: shop.sellerChatIds,
        lang: shop.sellerLang,
      });
    if (n.audience === "operator") {
      const op = deps.operator;
      return op ? { lang: "ru", send: (text) => op(text) } : null;
    }
    const buyerId = typeof n.params.buyer_id === "string" ? n.params.buyer_id : null;
    if (!buyerId) return null;
    const addr = (
      await deps.db.call("buyer_address", { p_bot_id: n.botId, p_buyer_id: buyerId })
    )[0]?.buyer_address as Record<string, unknown> | null | undefined;
    if (!addr?.channel) return null;
    const send = senderOf(shop, deps);
    return {
      lang: langOf(addr.language),
      send: (text, signal) =>
        send(
          addr.channel as Exclude<DeliveryChannel, "email">,
          {
            externalId: String(addr.external_id),
            conversationId: (addr.conversation_id as string | null) ?? null,
            accountId: (addr.account_id as string | null) ?? null,
          },
          text,
          signal,
        ),
    };
  };
  const report = await runNotifications(
    {
      db: deps.db,
      resolve,
      panelUrl: () => `${base}/admin/v4-today`,
      botIds: deps.botIds,
      budgetMs: deps.budgetMs,
      now: deps.now,
    },
    job === "notify-now" ? "now" : "digest",
  );
  return { shops: shops.size, ...report };
}
