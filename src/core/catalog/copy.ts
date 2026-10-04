import { serverFailure } from "@/lib/server-failure";
import { UserError } from "@/core/i18n/user-error";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Database, Json } from "@/core/db-types";
import { serviceDb } from "@/core/db/client.server";
import { isTenantStorageKey } from "@/core/storage/keys";
import { newUploadKey } from "@/core/storage/upload";
import { COURSE_MARKER_URL } from "@/core/courses/marker";
import { getProductForAdmin } from "./admin";

type ProductInsert = Database["public"]["Tables"]["products"]["Insert"];
type Bucket = "product-images" | "product-files";

const NAME_MAX = 200;

/** Название копии: «Название — копия», не длиннее поля товара. */
export function copyName(name: string, suffix: string): string {
  const tail = suffix.trim();
  if (!tail) return name.slice(0, NAME_MAX);
  return `${name.slice(0, Math.max(1, NAME_MAX - tail.length - 1)).trimEnd()} ${tail}`;
}

/**
 * Копия товара: новая карточка, скрытая с витрины, с теми же названием
 * (плюс пометка), ценами, вариантами, категориями, картинками и файлами.
 * Продаж, отзывов, листа ожидания и примера у копии нет; остаток, если он
 * считался, начинается с 0 — продавец сам решит, сколько выставить.
 *
 * Файлы в Storage копируются в новые ключи: удаление товара убирает его
 * файлы из бакета, и общий ключ оставил бы копию без картинки. Старые ключи
 * v1 без префикса клиента `deleteProduct` не удаляет — они общие по ссылке.
 * Курс (уроки, расписание, задания, тарифы) копируется без потоков и без
 * канала: даты старта и канал принадлежат набору, а не товару. Сбой на
 * любом шаге откатывает копию целиком.
 */
export async function copyProduct(
  ctx: TenantContext,
  productId: string,
  suffix: string,
): Promise<string> {
  const src = await getProductForAdmin(ctx, productId);
  if (!src) throw new UserError("err.catalog.copyNotFound", "Товар не найден.");

  const storage = serviceDb().storage;
  const copied: Array<{ bucket: Bucket; key: string }> = [];
  const duplicate = async (bucket: Bucket, key: string): Promise<string> => {
    if (!isTenantStorageKey(ctx.tenant.id, key)) return key;
    const next = newUploadKey(
      ctx.tenant.id,
      crypto.randomUUID().replace(/-/g, "").slice(0, 24),
      key,
    );
    const { error } = await storage.from(bucket).copy(key, next);
    if (error) throw serverFailure(`Копия товара: файл не скопирован: ${error.message}`);
    copied.push({ bucket, key: next });
    return next;
  };

  const row: ProductInsert = {
    bot_id: ctx.tenant.id,
    name: copyName(src.name, suffix),
    description: src.description,
    keywords: src.keywords,
    price: src.price,
    currency: src.currency,
    country_prices: src.country_prices as Json,
    category_ids: src.category_ids as Json,
    category_id: src.category_id,
    is_active: false,
    sort_order: src.sort_order,
    fulfillment_kind: src.fulfillment_kind,
    stock_quantity: src.stock_quantity === null ? null : 0,
    lead_time_days: src.lead_time_days,
    // Старые поля файла v1 (внешняя ссылка или ключ без префикса) — по ссылке;
    // метку курса вернёт saveCourse, если у курса есть уроки.
    file_url: src.file_url === COURSE_MARKER_URL ? null : src.file_url,
    file_path: src.file_path,
    file_name: src.file_name,
    file_url_kz: src.file_url_kz,
    file_path_kz: src.file_path_kz,
    file_name_kz: src.file_name_kz,
  };
  const { data: created, error: createError } = await ctx.db
    .from("products")
    .insert(row)
    .select("id")
    .single();
  if (createError || !created)
    throw serverFailure(`Копия товара: ${createError?.message ?? "строка не создана"}`);
  const newId = created.id;

  try {
    const images = (src.product_images ?? [])
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const materials = (src.product_material_files ?? [])
      .filter((f) => f.file_path)
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const variants = (src.product_variants ?? [])
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

    if (images.length) {
      const rows = [];
      for (const [i, im] of images.entries())
        rows.push({
          bot_id: ctx.tenant.id,
          product_id: newId,
          image_path: await duplicate("product-images", im.image_path),
          sort_order: i,
        });
      const { error } = await ctx.db.from("product_images").insert(rows);
      if (error) throw serverFailure(`Копия товара: картинки: ${error.message}`);
    }
    if (materials.length) {
      const rows = [];
      for (const [i, f] of materials.entries())
        rows.push({
          bot_id: ctx.tenant.id,
          product_id: newId,
          language: f.language ?? undefined,
          file_path: await duplicate("product-files", f.file_path!),
          file_name: f.file_name,
          sort_order: i,
        });
      const { error } = await ctx.db.from("product_material_files").insert(rows);
      if (error) throw serverFailure(`Копия товара: файлы: ${error.message}`);
    }
    // id задаём сами: тарифы курса привязаны к id варианта и переезжают вместе с ним.
    const variantIds = new Map(variants.map((v) => [v.id, crypto.randomUUID()]));
    if (variants.length) {
      const { error } = await ctx.db.from("product_variants").insert(
        variants.map((v, i) => ({
          id: variantIds.get(v.id)!,
          bot_id: ctx.tenant.id,
          product_id: newId,
          name: v.name,
          price: v.price,
          sort_order: i,
        })),
      );
      if (error) throw serverFailure(`Копия товара: варианты: ${error.message}`);
    }
    if (ctx.tenant.modules.courses) await copyCourse(ctx, productId, newId, variantIds, duplicate);
    // Период подписки лежит отдельно (app_settings product_subscription:<id>): без него копия стала бы разовым товаром.
    const { loadSubscriptionDays, saveSubscriptionDays } =
      await import("@/core/catalog/subscription");
    const days = await loadSubscriptionDays(ctx, productId);
    if (days) await saveSubscriptionDays(ctx, newId, days);
  } catch (e) {
    await rollback(ctx, newId, copied);
    throw e;
  }
  return newId;
}

async function copyCourse(
  ctx: TenantContext,
  from: string,
  to: string,
  variantIds: ReadonlyMap<string, string>,
  duplicate: (bucket: Bucket, key: string) => Promise<string>,
): Promise<void> {
  const { getCourse, saveCourse } = await import("@/core/courses/course.server");
  const course = await getCourse(ctx, from);
  // Копия переносит уроки, тарифы и сдачу ДЗ; потоки и эфиры привязаны к датам
  // оригинала и не копируются, поэтому курс из одних эфиров копировать нечего.
  if (!course.lessons.length) return;
  const lessons = [];
  for (const l of course.lessons)
    lessons.push({
      ...l,
      files: await Promise.all(
        l.files.map(async (f) => ({ ...f, path: await duplicate("product-files", f.path) })),
      ),
    });
  const tariffs = Object.fromEntries(
    Object.entries(course.tariffs ?? {}).flatMap(([oldId, t]) => {
      const id = variantIds.get(oldId);
      return id ? [[id, t] as const] : [];
    }),
  );
  await saveCourse(ctx, to, {
    schedule: course.schedule,
    lessons,
    homeworkDays: course.homeworkDays,
    ...(Object.keys(tariffs).length ? { tariffs } : {}),
  });
}

/** Откат копии: файлы, курс, период подписки и сама строка товара (картинки и варианты уходят каскадом). */
async function rollback(
  ctx: TenantContext,
  id: string,
  copied: ReadonlyArray<{ bucket: Bucket; key: string }>,
): Promise<void> {
  try {
    for (const bucket of ["product-images", "product-files"] as const) {
      const keys = copied.filter((c) => c.bucket === bucket).map((c) => c.key);
      if (keys.length) await serviceDb().storage.from(bucket).remove(keys);
    }
    await (await import("@/core/courses/course.server")).dropCourse(ctx, id);
    const { SUBSCRIPTION_PREFIX } = await import("@/core/catalog/subscription");
    await ctx.db
      .from("app_settings")
      .delete()
      .eq("bot_id", ctx.tenant.id)
      .eq("key", `${SUBSCRIPTION_PREFIX}${id}`);
    await ctx.db.from("products").delete().eq("id", id);
  } catch {
    // Откат — на лучшее усилие: исходная ошибка важнее.
  }
}
