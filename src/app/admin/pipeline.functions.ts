import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { UserError } from "@/core/i18n/user-error";
import { PIPELINE_STAGES } from "@/core/pipeline/stages";

/**
 * Воронка сделок (модуль crm_pipeline): доска, новая заявка, перенос заявки
 * по этапам, заметка и ответственный. Смотреть может вся команда, менять —
 * менеджер и выше. Заказы по доске не двигаются: их этап — статус заказа.
 */
const guards = () => import("@/app/auth/guards.server");

export const pipelineFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await (await guards()).requireAdminModule("crm_pipeline");
  const { pipelineBoard } = await import("@/core/pipeline/board");
  const { teamLogins } = await import("@/core/pipeline/team");
  return { board: await pipelineBoard(ctx), team: teamLogins(ctx.tenant) };
});

export const createLeadFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        name: z.string().trim().max(120).default(""),
        contact: z.string().trim().max(120).default(""),
        amount: z.number().positive().max(1e9).nullable().default(null),
        note: z.string().trim().max(1000).default(""),
      })
      .refine((v) => v.name || v.contact)
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await (await guards()).requireAdminModule("crm_pipeline", "manager");
    const { createLead } = await import("@/core/pipeline/leads");
    const { currencyForCountry, defaultCountryCode } = await import("@/core/pricing/pricing");
    const currency = (await currencyForCountry(ctx, await defaultCountryCode(ctx))) ?? "KZT";
    return createLead(ctx, { ...data, currency });
  });

export const updateLeadFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().min(1).max(80),
        stage: z.enum(PIPELINE_STAGES).optional(),
        note: z.string().trim().max(1000).nullable().optional(),
        owner: z.string().trim().max(64).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await (await guards()).requireAdminModule("crm_pipeline", "manager");
    const { teamLogins } = await import("@/core/pipeline/team");
    if (data.owner && !teamLogins(ctx.tenant).includes(data.owner))
      throw new UserError("err.pipeline.badOwner", "Такого сотрудника нет в команде магазина.");
    const { updateLead } = await import("@/core/pipeline/leads");
    const { id, ...patch } = data;
    const lead = await updateLead(ctx, id, patch);
    if (!lead) throw new UserError("err.pipeline.leadNotFound", "Заявка не найдена.");
    return lead;
  });
