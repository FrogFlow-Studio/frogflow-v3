import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { UserError } from "@/core/i18n/user-error";

/**
 * Обращения покупателей (модуль helpdesk): список, карточка и смена статуса,
 * ответственного, заметка. Смотреть может вся команда, менять — менеджер и
 * выше. Переписка с покупателем — в «Чате», здесь только учёт.
 */
const status = z.enum(["open", "waiting", "closed"]);

export const ticketsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ status: status.nullish() }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const ctx = await (await import("@/app/auth/guards.server")).requireAdminModule("helpdesk");
    const { listTickets, countOpenTickets, ratingStats } = await import("@/core/helpdesk/tickets");
    const { helpdeskTeam } = await import("./helpdesk.server");
    const [tickets, openCount, ratings] = await Promise.all([
      listTickets(ctx, data.status ?? null),
      countOpenTickets(ctx),
      ratingStats(ctx),
    ]);
    return { tickets, openCount, ratings, team: helpdeskTeam(ctx.tenant) };
  });

export const ticketFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await (await import("@/app/auth/guards.server")).requireAdminModule("helpdesk");
    const { getTicket } = await import("@/core/helpdesk/tickets");
    const { helpdeskTeam } = await import("./helpdesk.server");
    const ticket = await getTicket(ctx, data.id);
    if (!ticket) throw new UserError("err.ticket.notFound", "Обращение не найдено.");
    return { ticket, team: helpdeskTeam(ctx.tenant) };
  });

export const updateTicketFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: status.optional(),
        assignee: z.string().max(64).nullable().optional(),
        note: z.string().max(1000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const guards = await import("@/app/auth/guards.server");
    const ctx = await guards.requireAdminModule("helpdesk", "manager");
    const { helpdeskTeam } = await import("./helpdesk.server");
    // Ответственный — только из команды магазина, не произвольная строка.
    if (data.assignee && !helpdeskTeam(ctx.tenant).some((m) => m.username === data.assignee))
      throw new UserError("err.ticket.badAssignee", "Такого сотрудника нет в команде магазина.");
    const { getTicket, updateTicket } = await import("@/core/helpdesk/tickets");
    const before = await getTicket(ctx, data.id);
    if (!before) throw new UserError("err.ticket.notFound", "Обращение не найдено.");
    const ticket = await updateTicket(
      ctx,
      data.id,
      { status: data.status, assignee: data.assignee, note: data.note },
      await guards.adminActor(),
    );
    if (!ticket) throw new UserError("err.ticket.notFound", "Обращение не найдено.");
    const { notifyTicketClosed } = await import("./helpdesk.server");
    const notified =
      before.status !== "closed" && ticket.status === "closed"
        ? await notifyTicketClosed(ctx, ticket)
        : null;
    return { ticket, notified };
  });
