import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { isOutreachChannel, type OutreachChannel } from "@/core/leads/draft";
import { LEAD_STAGES, cleanLeadInput } from "@/core/leads/leads";

/**
 * Серверные функции панели оператора: лиды и воронка продаж.
 * Каждая начинается с requireOperator():
 * маршрутный гейт — только UX, функции вызываются по HTTP напрямую.
 * Реализация — в серверных модулях *.server.ts (не попадают в бандл).
 */
const guard = async () => (await import("@/app/auth/guards.server")).requireOperator();

/** Кто действует — логин оператора из базы; в журнале bot_events. */
const actor = async () =>
  (await (await import("./credentials.server")).operatorCredentialsSource()).username ?? "operator";

/** Воронка лидов отдела продаж FrogFlow (core/leads): список, добавление, стадия, заметки, журнал. */
const leadsImpl = () => import("./leads.server");

const pipelineImpl = () => import("./leads-pipeline.server");

const leadId = z.string().uuid();

const leadStage = z.enum(LEAD_STAGES);

export const leadsFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  const impl = await leadsImpl();
  return { leads: await impl.listLeads(), aiAvailable: impl.leadsAiAvailable() };
});

export const addLeadFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        businessName: z.string().max(200),
        niche: z.string().max(200),
        city: z.string().max(200),
        websiteUrl: z.string().max(400),
        instagramHandle: z.string().max(300),
        phone: z.string().max(60),
        email: z.string().max(200),
        signals: z.string().max(2000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    const input = cleanLeadInput(data);
    if (!input)
      throw new Error(
        "Нужны название и хотя бы один контакт: Instagram, телефон, почта или сайт (в правильном виде)",
      );
    return (await leadsImpl()).addLead(input, await actor());
  });

export const setLeadStageFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: leadId,
        from: z.string().max(40),
        to: leadStage,
        lostReason: z.string().max(300).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await leadsImpl()).setLeadStage(data, await actor());
  });

export const saveLeadNoteFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: leadId,
        notes: z.string().max(4000).nullable(),
        nextAction: z.string().max(300).nullable(),
        nextActionAt: z.string().datetime().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return { saved: await (await leadsImpl()).saveLeadNote(data) };
  });

/** «Создать магазин» из заявки с площадки (В19): клиент по нише и тарифу заявки, шаблон ниши, лид — «Клиент». */
export const openShopFromLeadFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: leadId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await import("./open-shop.server")).openShopFromLead(data.id, await actor());
  });

export const leadEventsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ id: leadId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return { events: await (await leadsImpl()).listLeadEvents(data.id) };
  });

export const leadPipelineFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return (await pipelineImpl()).getPipelineConfig();
});

export const saveLeadPipelineFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        enabled: z.boolean(),
        followUpDays: z.number().int().min(1).max(30),
        lostDays: z.number().int().min(3).max(120),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await pipelineImpl()).savePipelineConfig(data);
  });

export const scoreLeadFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: leadId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await leadsImpl()).scoreLead(data.id, await actor());
  });

/** Импорт лидов из CSV: ничего не отправляется, дубли отсекаются (leads.server importLeads). */
export const importLeadsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ csv: z.string().max(400_000) }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await leadsImpl()).importLeads(data.csv, await actor());
  });

export const huntLeadsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ niche: z.string().max(200), city: z.string().max(200) }).parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await import("./hunt.server")).huntLeads(data, await actor());
  });

export const draftLeadFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: leadId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await leadsImpl()).draftLead(data.id, await actor());
  });

export const saveLeadDraftFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ id: leadId, draft: z.string().max(2000).nullable() }).parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return { saved: await (await leadsImpl()).saveLeadDraft(data) };
  });

export const markLeadContactedFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: leadId,
        channel: z
          .string()
          .refine(isOutreachChannel)
          .transform((c) => c as OutreachChannel),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await leadsImpl()).markLeadContacted(data, await actor());
  });
