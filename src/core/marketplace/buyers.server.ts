import { serviceDb, type Db } from "@/core/db/client.server";
import { pageAll } from "@/core/db/page";
import { userKey } from "@/core/customers/customers";
import { servedByV2 } from "@/core/tenant/directory";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";
import { MarketplaceNotReady, isMissingTable } from "./not-ready";

/**
 * Аккаунт покупателя на площадке (В17). Человек = подтверждённое удостоверение
 * в канале (Telegram id или телефон WhatsApp); связи ведут к его профилям в
 * магазинах (`bot_users.user_key`). Баллы, заказы и адреса остаются у магазина:
 * здесь их не читают и не пишут. Таблицы общие для магазинов, поэтому всё
 * идёт под serviceDb, а подтверждение входа проверяется здесь, не в RLS.
 * Таблиц нет (миграция 19-17 не применена) — MarketplaceNotReady, вход по магазину как раньше.
 */
export type Channel = "telegram" | "whatsapp";
export type VerifiedBy = "telegram_login" | "code";

/** Удостоверение, уже подтверждённое входом в магазин (виджет Telegram или код в боте). */
export type VerifiedIdentity = { channel: Channel; id: string; via: VerifiedBy };

type DbErr = { code?: string | undefined; message: string } | null;
function check(what: string, error: DbErr): void {
  if (!error) return;
  if (isMissingTable(error)) throw new MarketplaceNotReady();
  throw serverFailure(`площадка, ${what}: ${error.message}`);
}
const duplicate = (e: DbErr) => e?.code === "23505";

/** Ключ профиля в магазине для этого удостоверения (`tg_<id>`, `wa_<телефон>`). */
export function identityUserKey(identity: Pick<VerifiedIdentity, "channel" | "id">): string {
  return userKey(identity.channel, identity.id);
}

/** Удостоверение годится: непустой id без пробелов, у Telegram — целое положительное число. */
export function validIdentity(identity: VerifiedIdentity): boolean {
  if (!/^\S{1,64}$/.test(identity.id)) return false;
  return identity.channel === "telegram" ? /^[1-9]\d{0,15}$/.test(identity.id) : true;
}

async function findBuyer(svc: Db, identity: VerifiedIdentity): Promise<string | null> {
  const { data, error } = await svc
    .from("marketplace_buyers")
    .select("id")
    .eq("channel", identity.channel)
    .eq("channel_id", identity.id)
    .maybeSingle();
  check("человек не прочитан", error);
  return (data as { id: string } | null)?.id ?? null;
}

/** Человек на площадке: создаём при первом подтверждённом входе, повтор и гонка дают тот же id. */
export async function ensureBuyer(
  identity: VerifiedIdentity,
  svc: Db = serviceDb(),
): Promise<string> {
  if (!validIdentity(identity)) throw serverFailure("площадка: некорректное удостоверение");
  const found = await findBuyer(svc, identity);
  if (found) {
    const { error } = await svc
      .from("marketplace_buyers")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", found);
    check("вход не отмечен", error);
    return found;
  }
  const { data, error } = await svc
    .from("marketplace_buyers")
    .insert({ channel: identity.channel, channel_id: identity.id })
    .select("id")
    .maybeSingle();
  if (duplicate(error)) {
    const again = await findBuyer(svc, identity);
    if (again) return again;
  }
  check("человек не создан", error);
  const id = (data as { id: string } | null)?.id;
  if (!id) throw serverFailure("площадка: человек не создан");
  return id;
}

export type LinkResult =
  | { status: "linked" | "already"; buyerId: string }
  | { status: "foreign" } // ключ профиля не принадлежит этому удостоверению
  | { status: "no-profile" } // в магазине такого покупателя ещё нет
  | { status: "taken" } // профиль уже у другого человека — не переписываем
  | { status: "unavailable" }; // магазин не на v2

/**
 * Привязать профиль магазина к человеку. Можно только свой профиль: ключ
 * обязан вытекать из подтверждённого удостоверения, профиль — существовать в
 * этом магазине. Уже занятый другим человеком профиль не перепривязывается.
 */
export async function linkBuyerToShop(
  ctx: TenantContext,
  identity: VerifiedIdentity,
  key: string,
  svc: Db = serviceDb(),
): Promise<LinkResult> {
  if (!servedByV2(ctx.tenant)) return { status: "unavailable" };
  if (!validIdentity(identity) || key !== identityUserKey(identity)) return { status: "foreign" };
  const { data: profile, error: pe } = await ctx.db
    .from("bot_users")
    .select("user_key")
    .eq("user_key", key)
    .maybeSingle();
  if (pe) throw serverFailure(`площадка, профиль в магазине не прочитан: ${pe.message}`);
  if (!profile) return { status: "no-profile" };
  const buyerId = await ensureBuyer(identity, svc);
  const { error } = await svc.from("marketplace_buyer_links").insert({
    bot_id: ctx.tenant.id,
    user_key: key,
    buyer_id: buyerId,
    verified_by: identity.via,
  });
  if (!error) return { status: "linked", buyerId };
  if (!duplicate(error)) check("связь не записана", error);
  const { data: held, error: re } = await svc
    .from("marketplace_buyer_links")
    .select("buyer_id")
    .eq("bot_id", ctx.tenant.id)
    .eq("user_key", key)
    .maybeSingle();
  check("связь не прочитана", re);
  const owner = (held as { buyer_id: string } | null)?.buyer_id;
  return owner === buyerId ? { status: "already", buyerId } : { status: "taken" };
}

export type BuyerShop = { botId: string; userKey: string };

/** Профили человека в магазинах: постранично, порядок — по уникальному ключу. */
export async function buyerShops(buyerId: string, svc: Db = serviceDb()): Promise<BuyerShop[]> {
  try {
    const rows = await pageAll<{ bot_id: string; user_key: string }>(
      (from, to) =>
        svc
          .from("marketplace_buyer_links")
          .select("bot_id, user_key")
          .eq("buyer_id", buyerId)
          .order("bot_id", { ascending: true })
          .order("user_key", { ascending: true })
          .range(from, to),
      "площадка, связи покупателя не прочитаны",
    );
    return rows.map((r) => ({ botId: r.bot_id, userKey: r.user_key }));
  } catch (e) {
    if (e instanceof Error && isMissingTable({ message: e.message }))
      throw new MarketplaceNotReady();
    throw e;
  }
}

/** Таблицы аккаунта есть? Нет — вход по магазину работает как раньше. */
export async function buyersReady(svc: Db = serviceDb()): Promise<boolean> {
  const { error } = await svc.from("marketplace_buyers").select("id").limit(1);
  if (isMissingTable(error)) return false;
  if (error) throw serverFailure(`площадка, аккаунты покупателей: ${error.message}`);
  return true;
}
