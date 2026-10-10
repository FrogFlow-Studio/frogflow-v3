import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Серверные функции панели оператора: подключение продавца к оплате Kaspi
 * через партнёрский API ApiPay. Каждая начинается с requireOperator():
 * маршрутный гейт — только UX, функции вызываются по HTTP напрямую.
 * Реализация — в apipay-partner.server.ts (не попадает в бандл).
 */
const guard = async () => (await import("@/app/auth/guards.server")).requireOperator();

/** Кто действует — логин оператора из базы; в журнале bot_events. */
const actor = async () =>
  (await (await import("./credentials.server")).operatorCredentialsSource()).username ?? "operator";

const impl = () => import("./apipay-partner.server");

const botId = z.string().uuid();

const phone = z.string().trim().min(10).max(20);

export const apipayPartnerKeyStateFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return { configured: await (await impl()).partnerKeyConfigured() };
});

/** Партнёрский ключ ApiPay; пустая строка стирает. Назад не отдаётся. */
export const setApipayPartnerKeyFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ value: z.string().max(500) }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    await (await impl()).setPartnerKey(data.value);
    return { ok: true };
  });

export const apipayClientStateFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ botId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await impl()).apipayClientState(data.botId);
  });

export const apipayCreateOrgFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return { orgId: await (await impl()).apipayCreateOrg(data.botId, await actor()) };
  });

export const apipaySendCashierPhoneFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId, phone }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    await (await impl()).apipaySendCashierPhone(data.botId, data.phone, await actor());
    return { ok: true };
  });

export const apipayVerifyCashierFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId, otp: z.string().trim().max(10) }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    await (await impl()).apipayVerifyCashier(data.botId, data.otp, await actor());
    return { ok: true };
  });

export const apipayKycLinkFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return { url: await (await impl()).apipayKycLink(data.botId, await actor()) };
  });

export const apipayPlansFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return (await impl()).apipayPlans();
});

export const apipayPayTariffFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        botId,
        tierId: z.string().trim().min(1).max(50),
        months: z.number().int().min(1).max(12),
        phone,
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    await (
      await impl()
    ).apipayPayTariff(
      data.botId,
      { tierId: data.tierId, months: data.months, phone: data.phone },
      await actor(),
    );
    return { ok: true };
  });

export const apipayIssueKeyFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId, reissue: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await impl()).apipayIssueKey(data.botId, data.reissue, await actor());
  });
