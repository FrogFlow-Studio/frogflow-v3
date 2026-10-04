import { serviceDb } from "@/core/db/client.server";
import { pageAll } from "@/core/db/page";
import { INVITE_NOTE_PREFIX, creditCheck, type CreditCheck } from "@/core/invites/invites";
import { nextPeriod } from "@/core/plans/plans";
import {
  invalidateTenantDirectory,
  nextSettingsRev,
  settingsRev,
  tenantDirectory,
} from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { reportError } from "@/lib/errors";
import { serverFailure } from "@/lib/server-failure";
import { shownError } from "@/lib/shown-error";
import { paidShops } from "@/app/invites/invites.server";
import { addPayment, subscriptionExpiresAt } from "./billing.server";
import { logEvent } from "./operator.server";

/**
 * Приглашения авторов в панели оператора (core/invites): кто кого пригласил,
 * оплатил ли новичок тариф, выдан ли зачёт. Зачёт — одна кнопка оператора:
 * платёж на 0 ₸ пригласившему с продлением на месяц и номером платежа новичка
 * в примечании (виден в журнале оплат), отметка `invite.reward` у новичка.
 * Отметку ставит условное обновление по `settings.rev` ДО платежа: выигравший
 * пишет платёж, двойной клик или два оператора второй раз ничего не выдадут.
 */
export type InviteView = {
  invitedBy: null | {
    id: string;
    name: string;
    at: string;
    paid: boolean;
    credited: boolean;
    /** Причина, по которой зачёт сейчас недоступен; null — можно зачесть. */
    blocked: "already" | "self" | "not_paid" | "inviter_gone" | null;
  };
  invited: Array<{ id: string; name: string; paid: boolean; credited: boolean }>;
};

const BLOCK_TEXT: Record<string, string> = {
  already: "Месяц за это приглашение уже зачтён.",
  self: "Похоже, магазин пригласил сам себя (тот же Telegram или контакт владельца): зачёт не выдаётся.",
  not_paid: "Приглашённый ещё не оплатил тариф: платежа за подписку нет.",
  inviter_gone: "Пригласивший магазин не найден или в архиве.",
  no_invite: "У этого магазина нет приглашения.",
};

type Contact = { id: string; owner_contact: string | null };

async function contacts(ids: string[]): Promise<Map<string, string | null>> {
  const { data, error } = await serviceDb().from("bots").select("id, owner_contact").in("id", ids);
  if (error) throw serverFailure(`[invites] контакты владельцев не прочитаны: ${error.message}`);
  return new Map((data as Contact[]).map((r) => [r.id, r.owner_contact]));
}

async function paymentsOf(botId: string) {
  const rows = await pageAll(
    (from, to) =>
      serviceDb()
        .from("subscription_payments")
        .select("id, amount, note")
        .eq("bot_id", botId)
        .order("id", { ascending: true })
        .range(from, to),
    "[invites] платежи новичка не прочитаны",
  );
  return rows.map((p) => ({ id: p.id, amount: Number(p.amount), note: p.note }));
}

export async function inviteView(botId: string): Promise<InviteView> {
  const dir = await tenantDirectory(true);
  const me = dir.find((t) => t.id === botId);
  if (!me) throw shownError("Клиент не найден");
  const mine = dir.filter((t) => t.settings.invite?.by === botId);
  const ids = [...(me.settings.invite ? [me.id] : []), ...mine.map((t) => t.id)];
  const paid = ids.length ? await paidShops(ids) : new Set<string>();
  let invitedBy: InviteView["invitedBy"] = null;
  const inv = me.settings.invite;
  if (inv) {
    const inviter = dir.find((t) => t.id === inv.by && !t.archived);
    let blocked: NonNullable<InviteView["invitedBy"]>["blocked"] = null;
    if (!inviter) blocked = "inviter_gone";
    else {
      const c = await contacts([me.id, inviter.id]);
      const check = creditCheck({
        invite: inv,
        inviter: {
          id: inviter.id,
          ownerTelegramId: inviter.ownerTelegramId,
          contact: c.get(inviter.id) ?? null,
        },
        invitee: { id: me.id, ownerTelegramId: me.ownerTelegramId, contact: c.get(me.id) ?? null },
        // Оплата — по факту платежа: удалённый платёж из списка уходит, зачёт не выдаётся.
        payments: paid.has(me.id) ? [{ id: "paid", amount: 1, note: null }] : [],
      });
      blocked = check.ok ? null : check.reason === "no_invite" ? null : check.reason;
    }
    invitedBy = {
      id: inv.by,
      name: dir.find((t) => t.id === inv.by)?.name ?? inv.by,
      at: inv.at,
      paid: paid.has(me.id),
      credited: Boolean(inv.reward),
      blocked,
    };
  }
  return {
    invitedBy,
    invited: mine.map((t) => ({
      id: t.id,
      name: t.name,
      paid: paid.has(t.id),
      credited: Boolean(t.settings.invite?.reward),
    })),
  };
}

/** Условно переписать settings новичка: только если `rev` с прочтения не менялся. */
async function writeSettingsIfRev(
  botId: string,
  rev: number | null,
  next: Record<string, unknown>,
): Promise<boolean> {
  const revPath = "settings->>rev" as "id";
  let q = serviceDb()
    .from("bots")
    .update({ settings: { ...next, rev: nextSettingsRev({ rev: rev ?? undefined }) } as never })
    .eq("id", botId);
  q = rev === null ? q.is(revPath, null as never) : q.eq(revPath, String(rev));
  const { data, error } = await q.select("id");
  if (error) throw serverFailure(`bots.settings: ${error.message}`);
  if (data?.length) invalidateTenantDirectory();
  return Boolean(data?.length);
}

async function readSettings(botId: string): Promise<Record<string, unknown>> {
  const { data, error } = await serviceDb()
    .from("bots")
    .select("settings")
    .eq("id", botId)
    .maybeSingle();
  if (error) throw serverFailure(`bots.settings: не прочитаны (${error.message})`);
  if (!data) throw serverFailure(`bots.settings: магазин ${botId} не найден`);
  const s = data.settings;
  return s && typeof s === "object" && !Array.isArray(s) ? (s as Record<string, unknown>) : {};
}

export async function creditInvite(
  inviteeId: string,
  actor: string,
  now = new Date(),
): Promise<{ inviterName: string; periodEnd: string }> {
  const dir = await tenantDirectory(true);
  const invitee: Tenant | undefined = dir.find((t) => t.id === inviteeId);
  const inv = invitee?.settings.invite;
  if (!invitee || !inv) throw shownError(BLOCK_TEXT.no_invite!);
  const inviter = dir.find((t) => t.id === inv.by && !t.archived);
  if (!inviter) throw shownError(BLOCK_TEXT.inviter_gone!);
  const [c, payments] = await Promise.all([
    contacts([invitee.id, inviter.id]),
    paymentsOf(invitee.id),
  ]);
  const check: CreditCheck = creditCheck({
    invite: inv,
    inviter: {
      id: inviter.id,
      ownerTelegramId: inviter.ownerTelegramId,
      contact: c.get(inviter.id) ?? null,
    },
    invitee: {
      id: invitee.id,
      ownerTelegramId: invitee.ownerTelegramId,
      contact: c.get(invitee.id) ?? null,
    },
    payments,
  });
  if (!check.ok) throw shownError(BLOCK_TEXT[check.reason]!);

  // Срок пригласившего читаем до отметки: сбой чтения не должен превращаться в
  // «месяц с сегодняшнего дня» поверх уже оплаченного периода.
  const today = now.toISOString().slice(0, 10);
  const period = nextPeriod(await subscriptionExpiresAt(inviter.id), "month", today);

  // Захват: отметка до платежа, условно по rev. Не выиграл — ничего не выдаём.
  const raw = await readSettings(invitee.id);
  const rev = settingsRev(raw);
  const rawInvite = (raw.invite ?? {}) as Record<string, unknown>;
  if (rawInvite.reward) throw shownError(BLOCK_TEXT.already!);
  const marked = {
    ...raw,
    invite: {
      ...rawInvite,
      reward: { at: now.toISOString(), by: actor, payment_id: check.paymentId },
    },
  };
  if (!(await writeSettingsIfRev(invitee.id, rev, marked)))
    throw shownError("Настройки магазина изменились: обновите страницу и повторите.");

  try {
    await addPayment(
      inviter.id,
      {
        period_start: period.start,
        period_end: period.end,
        amount: 0,
        currency: "KZT",
        note: `${INVITE_NOTE_PREFIX} «${invitee.name}» (платёж ${check.paymentId})`,
      },
      actor,
    );
  } catch (e) {
    // Платёж не записан: снимаем отметку, чтобы оператор мог повторить.
    try {
      const after = await readSettings(invitee.id);
      const inviteNow = { ...((after.invite ?? {}) as Record<string, unknown>) };
      delete inviteNow.reward;
      await writeSettingsIfRev(invitee.id, settingsRev(after), { ...after, invite: inviteNow });
    } catch (re) {
      await reportError(
        serverFailure(`Зачёт за приглашение ${invitee.id}: отметка осталась без платежа`),
        {
          where: "invites.credit",
          botId: invitee.id,
          extra: { error: re instanceof Error ? re.message : String(re) },
        },
      );
    }
    throw e;
  }
  const event = {
    action: "invite_credit",
    inviter_id: inviter.id,
    invitee_id: invitee.id,
    invitee_payment_id: check.paymentId,
    invitee_amount: check.amount,
    credited_until: period.end,
  };
  await logEvent(inviter.id, "payment", event, actor);
  await logEvent(invitee.id, "payment", { ...event, action: "invite_reward_issued" }, actor);
  return { inviterName: inviter.name, periodEnd: period.end };
}
