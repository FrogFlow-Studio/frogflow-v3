import type { Ticket } from "@/core/helpdesk/tickets";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";

export type TeamMember = { username: string; name: string | null };

/** Кому можно назначить обращение: владелец и сотрудники с правом изменений (не «просмотр»). */
export function helpdeskTeam(tenant: Pick<Tenant, "settings">): TeamMember[] {
  const admin = tenant.settings.admin;
  const out: TeamMember[] = [];
  if (admin?.username) out.push({ username: admin.username, name: null });
  for (const u of admin?.users ?? [])
    if (u.role !== "viewer" && u.username) out.push({ username: u.username, name: u.name ?? null });
  return out;
}

/**
 * Продавец закрыл обращение — покупателю приходит «Обращение #N закрыто»
 * в его канал, как ответ менеджера (запись попадает и в «Чат»). Не
 * доставилось — не беда: статус уже сменён, продавец видит это в чате.
 */
export async function notifyTicketClosed(
  ctx: TenantContext,
  ticket: Pick<Ticket, "number" | "telegramId">,
): Promise<boolean> {
  const { getCustomerByTelegramId } = await import("@/core/customers/customers");
  const { COPY } = await import("@/channels/telegram/copy");
  const customer = await getCustomerByTelegramId(ctx, ticket.telegramId);
  const locale = customer?.state.locale ?? ctx.tenant.settings.default_locale ?? "ru";
  const text = (COPY[locale] ?? COPY.ru).ticketClosed(ticket.number);
  try {
    const { replyAsManager } = await import("./admin.server");
    await replyAsManager(ctx, ticket.telegramId, text);
    return true;
  } catch (e) {
    console.error(`[helpdesk:${ctx.tenant.id}] закрытие #${ticket.number} не доставлено`, e);
    return false;
  }
}
