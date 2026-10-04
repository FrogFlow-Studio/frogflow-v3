import { env } from "@/config/env";
import { serviceDb } from "@/core/db/client.server";
import { pageAll } from "@/core/db/page";
import { INVITE_NOTE_PREFIX, inviteToken, parseInviteToken } from "@/core/invites/invites";
import { servedByV2 } from "@/core/tenant/directory";
import { tenantDirectory, type TenantContext } from "@/core/tenant/resolve.server";

/** Пригласивший по токену из ссылки регистрации: только живой магазин на v2; иначе null (регистрация идёт без приглашения). */
export async function inviterForSignup(token: string | null | undefined): Promise<string | null> {
  const id = parseInviteToken(env().SESSION_SECRET, token);
  if (!id) return null;
  const t = (await tenantDirectory()).find((x) => x.id === id);
  return t && !t.archived && servedByV2(t) ? id : null;
}

/** Запомнить приглашение у нового магазина. Сбой не ломает регистрацию — вызывающий ловит. */
export async function recordInvite(newId: string, inviterId: string, now = new Date()) {
  if (newId === inviterId) return;
  const { patchTenantSettings } = await import("@/core/tenant/resolve.server");
  await patchTenantSettings(newId, { invite: { by: inviterId, at: now.toISOString() } });
}

export type InviteCard = {
  link: string;
  discountPercent: number;
  /** Сколько авторов зарегистрировалось по ссылке / оплатили тариф / получили зачёт. Имён нет. */
  registered: number;
  paid: number;
  credited: number;
};

const CHUNK = 200;

/** Сколько из этих магазинов хоть раз оплатили тариф (платёж больше нуля, не зачётный). */
export async function paidShops(ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const rows = await pageAll(
      (from, to) =>
        serviceDb()
          .from("subscription_payments")
          .select("id, bot_id, amount, note")
          .in("bot_id", chunk)
          .order("id", { ascending: true })
          .range(from, to),
      "[invites] платежи не прочитаны",
    );
    for (const r of rows)
      if (Number(r.amount) > 0 && !(r.note ?? "").startsWith(INVITE_NOTE_PREFIX)) out.add(r.bot_id);
  }
  return out;
}

export async function inviteCard(ctx: TenantContext): Promise<InviteCard> {
  const { INVITE_DISCOUNT_PERCENT } = await import("@/core/invites/invites");
  const mine = (await tenantDirectory()).filter((t) => t.settings.invite?.by === ctx.tenant.id);
  const paid = (await paidShops(mine.map((t) => t.id))).size;
  return {
    link: `${ctx.appUrl.replace(/\/$/, "")}/signup?invite=${inviteToken(env().SESSION_SECRET, ctx.tenant.id)}`,
    discountPercent: INVITE_DISCOUNT_PERCENT,
    registered: mine.length,
    paid,
    credited: mine.filter((t) => t.settings.invite?.reward).length,
  };
}
