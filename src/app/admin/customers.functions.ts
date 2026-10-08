import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { UserError } from "@/core/i18n/user-error";

/**
 * Админка продавца: поиск по админке и покупатели.
 * Каждая серверная функция начинается с гварда (requireAdmin…): контекст
 * арендатора берётся из сессии, подключение к базе — под его ролью.
 */

const admin = async () => (await import("@/app/auth/guards.server")).requireAdmin();

/** Изменения — менеджеру и владельцу; настройки, оплата, модули, команда — только владельцу (core/auth/roles). */
const adminWrite = async () =>
  (await import("@/app/auth/guards.server")).requireAdminRole("manager");

/** Разделы бухгалтера (guards.server requireAdminFinance): ответ без контактов, если это он. */
const finance = async () => (await import("@/app/auth/guards.server")).requireAdminFinance();

/** Поиск по админке (⌘K): заказы, товары и покупатели по одной строке (core/search/admin-search). */
export const adminSearchFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ q: z.string().trim().min(1).max(100) }).parse(d))
  .handler(async ({ data }) => {
    const { ctx, accountant } = await finance();
    const { adminSearch } = await import("@/core/search/admin-search");
    return adminSearch(ctx, data.q, accountant);
  });

/* ── покупатели ──────────────────────────────────────────────────── */

export const customersFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ q: z.string().optional() }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const ctx = await admin();
    return (await import("@/core/orders/admin")).listCustomers(ctx, data.q);
  });

/** Карточка покупателя: профиль, заказы, обращения, заявки, чат, теги и заметка продавца. */
export const customerCardFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ key: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await admin();
    const { customerCard, knownTags } = await import("@/core/customers/card");
    const [card, tags] = await Promise.all([customerCard(ctx, data.key), knownTags(ctx)]);
    if (!card) throw new UserError("err.customer.notFound", "Покупатель не найден.");
    return { card, tags };
  });

/** Теги и заметка продавца о покупателе (слиянием в bot_users.metadata). */
export const saveCustomerNoteFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        key: z.string().min(1).max(200),
        tags: z.array(z.string().max(100)).max(50),
        note: z.string().max(4000),
        // Версия заметки из последнего чтения (null — заметки не было); идёт в условие записи.
        version: z.string().datetime({ offset: true }).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { setSellerNote } = await import("@/core/customers/card");
    const r = await setSellerNote(
      ctx,
      data.key,
      { tags: data.tags, note: data.note },
      data.version,
    );
    if (!r) throw new UserError("err.customer.notFound", "Покупатель не найден.");
    // saved: false — заметку успели изменить; в ответе актуальная, форма показывает её и просит проверить.
    return r;
  });

/** «Это тот же человек»: ручная связь двух профилей покупателя (core/customers/identity). */
export const linkCustomerFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ key: z.string().min(1).max(200), other: z.string().min(1).max(200) }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { linkProfiles } = await import("@/core/customers/identity");
    if (!(await linkProfiles(ctx, data.key, data.other)))
      throw new UserError("err.customer.notFound", "Покупатель не найден.");
    return { ok: true };
  });

export const unlinkCustomerFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ key: z.string().min(1).max(200), other: z.string().min(1).max(200) }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { unlinkProfiles } = await import("@/core/customers/identity");
    await unlinkProfiles(ctx, data.key, data.other);
    return { ok: true };
  });

/** День рождения покупателя из карточки (core/funnel/birthday); пусто — убрать. */
export const saveCustomerBirthdayFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ key: z.string().min(1).max(200), birthday: z.string().max(20) }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { parseBirthday, setCustomerBirthday } = await import("@/core/funnel/birthday");
    const day = data.birthday.trim() ? parseBirthday(data.birthday) : null;
    if (data.birthday.trim() && !day)
      throw new UserError("err.customer.badBirthday", "Не разобрал дату — например 15.03");
    const { getCustomer } = await import("@/core/customers/customers");
    const c = await getCustomer(ctx, data.key);
    if (!c) throw new UserError("err.customer.notFound", "Покупатель не найден.");
    await setCustomerBirthday(ctx, c, day);
    return { birthday: day };
  });

export const setBlockedFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        telegramId: z.number().int(),
        blocked: z.boolean(),
        username: z.string().nullable().optional(),
        firstName: z.string().nullable().optional(),
        reason: z.string().max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireAdminModule } = await import("@/app/auth/guards.server");
    const ctx = await requireAdminModule("blocked", "manager");
    await (
      await import("@/core/orders/admin")
    ).setBlocked(ctx, data.telegramId, data.blocked, data);
    return { ok: true };
  });
