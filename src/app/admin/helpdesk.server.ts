import type { Ticket } from "@/core/helpdesk/tickets";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { logFailure } from "@/lib/log-failure";

export type TeamMember = { username: string; name: string | null };

/** Кому можно назначить обращение: владелец и сотрудники с правом изменений (не «просмотр»). */
export function helpdeskTeam(tenant: Pick<Tenant, "settings">): TeamMember[] {
  const admin = tenant.settings.admin;
  const out: TeamMember[] = [];
  if (admin?.username) out.push({ username: admin.username, name: null });
  for (const u of admin?.users ?? [])
    if (u.role === "manager" && u.username)
      out.push({ username: u.username, name: u.name ?? null });
  return out;
}

/**
 * Продавец закрыл обращение — покупателю приходит «Обращение #N закрыто»
 * в его канал, как ответ менеджера (запись попадает и в «Чат»), и просьба
 * оценить 1–5: в Telegram — кнопками, в Direct/WhatsApp — ответом цифрой. Не
 * доставилось — не беда: статус уже сменён, продавец видит это в чате.
 */
export async function notifyTicketClosed(
  ctx: TenantContext,
  ticket: Pick<Ticket, "id" | "number" | "telegramId">,
): Promise<boolean> {
  const { getCustomerByTelegramId } = await import("@/core/customers/customers");
  const { COPY } = await import("@/channels/telegram/copy");
  const customer = await getCustomerByTelegramId(ctx, ticket.telegramId);
  const locale = customer?.state.locale ?? ctx.tenant.settings.default_locale ?? "ru";
  // Уже оценённое (закрыли повторно после переоткрытия) — снова не просим.
  const { getTicket } = await import("@/core/helpdesk/tickets");
  const rated = (await getTicket(ctx, ticket.id).catch(() => null))?.rating != null;
  const m = COPY[locale] ?? COPY.ru;
  const inTelegram = !customer || customer.platform === "telegram";
  const text = rated
    ? m.ticketClosed(ticket.number)
    : `${m.ticketClosed(ticket.number)}\n\n${inTelegram ? m.ticketRateTg : m.ticketRateDm}`;
  try {
    const { replyAsManager } = await import("./admin.server");
    await replyAsManager(
      ctx,
      ticket.telegramId,
      text,
      undefined,
      undefined,
      inTelegram && !rated
        ? {
            replyMarkup: {
              inline_keyboard: [
                [1, 2, 3, 4, 5].map((n) => ({
                  text: "⭐".repeat(n),
                  callback_data: `tkr:${ticket.id}:${n}`,
                })),
              ],
            },
          }
        : {},
    );
    // Окно ответа цифрой отсчитывается от отправки; не записалось — оценку всё равно можно дать кнопкой.
    if (rated) return true;
    const { markRatingAsked } = await import("@/core/helpdesk/tickets");
    await markRatingAsked(ctx, ticket.id).catch((e) =>
      logFailure("helpdesk.markRatingAsked", e, { botId: ctx.tenant.id }),
    );
    return true;
  } catch (e) {
    logFailure("helpdesk.closeNotice", e, { botId: ctx.tenant.id });
    return false;
  }
}
