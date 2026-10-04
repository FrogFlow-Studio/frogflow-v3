import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Сегменты покупателей видят и считают владелец, менеджер и «просмотр»; меняют — владелец и менеджер. */
const admin = async () => (await import("@/app/auth/guards.server")).requireAdmin();
const adminWrite = async () =>
  (await import("@/app/auth/guards.server")).requireAdminRole("manager");

const ruleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("orders_min"), min: z.number().int().min(1).max(1000) }),
  z.object({ kind: z.literal("inactive"), days: z.number().int().min(1).max(3650) }),
  z.object({ kind: z.literal("tag"), tag: z.string().trim().min(1).max(32) }),
]);

/** Готовые и сохранённые сегменты; кто покупал, считается отдельно — по нажатию. */
export const customerSegmentsFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const { listSegments, PRESET_SEGMENTS } = await import("@/core/customers/saved-segments");
  return { presets: PRESET_SEGMENTS, saved: await listSegments(ctx) };
});

/** Кто входит в сегмент: всего и первые 50 (без телефонов и почты). */
export const segmentMembersFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ rule: ruleSchema }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await admin();
    const { segmentMembers } = await import("@/core/customers/saved-segments");
    return segmentMembers(ctx, data.rule);
  });

export const saveCustomerSegmentFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ name: z.string().trim().min(1).max(40), rule: ruleSchema }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { saveSegment } = await import("@/core/customers/saved-segments");
    return { id: await saveSegment(ctx, data) };
  });

export const deleteCustomerSegmentFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().min(1).max(100) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { deleteSegment } = await import("@/core/customers/saved-segments");
    await deleteSegment(ctx, data.id);
    return { ok: true };
  });
