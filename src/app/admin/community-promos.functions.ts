import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { JOINT } from "@/core/community/joint";

/**
 * Совместные акции (core/community/joint.server). Нужен модуль промокодов. Без таблиц (миграция 19-4
 * не применена) отвечают { soon: true }. Читает любой сотрудник, пишет владелец или менеджер.
 */
const id = z.string().uuid();
const guardRead = async () => (await import("@/app/auth/guards.server")).requireAdmin();
const guardWrite = async () =>
  (await import("@/app/auth/guards.server")).requireAdminModule("coupons", "manager");
const soonable = async () => (await import("@/core/community/not-ready")).orSoon;
const joint = () => import("@/core/community/joint.server");
const terms = z.object({
  code: z.string().max(60),
  percent: z.number().int().min(JOINT.percentMin).max(JOINT.percentMax),
  conditions: z.string().max(JOINT.conditions * 3),
});

export const jointReadyFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await guardRead();
  const orSoon = await soonable();
  const r = await orSoon(async () => ({ ready: await (await joint()).jointReady(ctx) }));
  return { ready: !r.soon && r.ready };
});

export const jointPromosFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await guardRead();
  const orSoon = await soonable();
  return orSoon(async () => {
    const j = await joint();
    return { promos: await j.listJointPromos(ctx), partners: await j.jointPartners(ctx) };
  });
});

export const createJointPromoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        title: z.string().max(300),
        endsAt: z.string().max(40),
        partnerIds: z.array(id).min(1).max(2),
        terms,
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await guardWrite();
    const orSoon = await soonable();
    return orSoon(async () =>
      (await import("./community-promos.server")).proposeJointPromo(ctx, data),
    );
  });

export const acceptJointPromoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ promoId: id, terms }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await guardWrite();
    const orSoon = await soonable();
    return orSoon(async () => (await joint()).acceptJointPromo(ctx, data.promoId, data.terms));
  });

export const declineJointPromoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ promoId: id }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await guardWrite();
    const orSoon = await soonable();
    return orSoon(async () => {
      await (await joint()).declineJointPromo(ctx, data.promoId);
      return {};
    });
  });
