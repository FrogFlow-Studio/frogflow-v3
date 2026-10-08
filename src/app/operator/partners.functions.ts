import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Серверные функции панели оператора: партнёры.
 * Каждая начинается с requireOperator():
 * маршрутный гейт — только UX, функции вызываются по HTTP напрямую.
 * Реализация — в серверных модулях *.server.ts (не попадают в бандл).
 */
const guard = async () => (await import("@/app/auth/guards.server")).requireOperator();

/** Кто действует — логин оператора из базы; в журнале bot_events. */
const actor = async () =>
  (await (await import("./credentials.server")).operatorCredentialsSource()).username ?? "operator";

const botId = z.string().uuid();

/** Партнёрская программа агентств (core/partners): партнёры, их клиенты и комиссия. */
export const partnersFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  const { env } = await import("@/config/env");
  const { tenantDirectory } = await import("@/core/tenant/resolve.server");
  const { isInternalTenant } = await import("@/core/tenant/internal");
  const partners = await (await import("./partners.server")).partnersOverview(env().APP_URL);
  const clients = (await tenantDirectory(true))
    .filter((t) => !t.archived && !isInternalTenant(t.id))
    .map((t) => ({ botId: t.id, name: t.name, partner: t.settings.partner ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { partners, clients, signupUrl: `${env().APP_URL}/signup?partner=` };
});

export const savePartnerFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        code: z.string().max(30),
        name: z.string().max(120),
        contact: z.string().max(200),
        percent: z.number().min(0).max(50),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await import("./partners.server")).savePartner(data);
  });

export const deletePartnerFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ code: z.string().max(30) }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    await (await import("./partners.server")).deletePartner(data.code);
    return { ok: true };
  });

export const setClientPartnerFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId, code: z.string().max(30).nullable() }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    await (await import("./partners.server")).setClientPartner(data.botId, data.code);
    const { logEvent } = await import("./operator.server");
    await logEvent(data.botId, "meta", { action: "partner", partner: data.code }, await actor());
    return { ok: true };
  });
