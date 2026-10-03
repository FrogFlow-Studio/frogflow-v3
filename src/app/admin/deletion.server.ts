import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { serviceDb } from "@/core/db/client.server";
import { UserError } from "@/core/i18n/user-error";
import { invalidateTenantDirectory, patchTenantSettings } from "@/core/tenant/resolve.server";
import { deletionConfirmed, deletionDue, deletionDueAt } from "@/core/tenant/deletion";

/**
 * Удаление магазина владельцем (core/tenant/deletion): запрос ставит паузу
 * и запоминает прежний статус, восстановление возвращает его. Статус и
 * settings — строка bots, её пишет платформа (serviceDb: справочник
 * арендаторов), как и оператор при паузе клиента.
 */
async function setStatus(botId: string, status: Tenant["status"]): Promise<void> {
  const { error } = await serviceDb().from("bots").update({ status }).eq("id", botId);
  if (error) throw new Error(`bots.status: ${error.message}`);
}

async function alertOperator(html: string): Promise<void> {
  const { sendOperatorAlert } = await import("@/app/operator/health-alerts.server");
  await sendOperatorAlert(html).catch((e) => console.error("[deletion] оператору", e));
}

export async function requestShopDeletion(
  ctx: TenantContext,
  confirmName: string,
  actor: string,
): Promise<{ dueAt: string }> {
  const t = ctx.tenant;
  if (t.settings.deletion)
    return { dueAt: deletionDueAt(t.settings.deletion.requested_at).toISOString() };
  // Сверяем с названием, которое продавец видит в админке (настройка shop_name).
  const { getSetting } = await import("@/core/settings/settings");
  const shownName = (await getSetting(ctx, "shop_name"))?.trim() || t.name;
  if (!deletionConfirmed(confirmName, shownName))
    throw new UserError(
      "err.deletion.confirm",
      "Введите название магазина точно так, как оно указано в настройках",
    );
  const requestedAt = new Date().toISOString();
  await patchTenantSettings(t.id, {
    deletion: { requested_at: requestedAt, by: actor, prev_status: t.status },
  });
  await setStatus(t.id, "paused");
  invalidateTenantDirectory();
  await alertOperator(
    `🗑 Владелец магазина «${t.name}» (${t.id}) запросил удаление. Магазин на паузе, данные удалятся ${deletionDueAt(requestedAt).toISOString().slice(0, 10)}, если он не восстановит его.`,
  );
  return { dueAt: deletionDueAt(requestedAt).toISOString() };
}

export async function cancelShopDeletion(ctx: TenantContext, actor: string): Promise<void> {
  const d = ctx.tenant.settings.deletion;
  if (!d) return;
  await setStatus(ctx.tenant.id, d.prev_status);
  await patchTenantSettings(ctx.tenant.id, { deletion: null });
  invalidateTenantDirectory();
  await alertOperator(
    `↩️ Магазин «${ctx.tenant.name}» (${ctx.tenant.id}) восстановлен владельцем (${actor}) — удаление отменено.`,
  );
}

const BUCKETS = ["product-images", "product-files", "payment-proofs"] as const;

/** Все ключи под префиксом клиента в бакете (папки обходятся вглубь). */
async function listTenantKeys(bucket: string, prefix: string): Promise<string[]> {
  const storage = serviceDb().storage.from(bucket);
  const out: string[] = [];
  const walk = async (dir: string, depth: number) => {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await storage.list(dir, { limit: 1000, offset });
      if (error) throw new Error(`${bucket}/${dir}: ${error.message}`);
      const rows = data ?? [];
      for (const r of rows) {
        const path = `${dir}/${r.name}`;
        // У папки в Storage нет id; глубже трёх уровней ключей v2 не бывает.
        if (r.id === null) {
          if (depth < 3) await walk(path, depth + 1);
        } else out.push(path);
      }
      if (rows.length < 1000) break;
    }
  };
  await walk(prefix, 0);
  return out;
}

/**
 * Крон ретеншна: холд истёк — магазин в архив (админка и витрина закрыты,
 * вебхук Telegram снят), файлы клиента удаляются из хранилища. Строки
 * базы остаются: заказы и платежи нужны для учёта и споров.
 */
export async function finalizeDueDeletions(
  tenants: Tenant[],
  now = Date.now(),
): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  for (const t of tenants) {
    if (t.archived || !deletionDue(t.settings.deletion, now)) continue;
    try {
      // Архивирует тот, чья условная запись прошла (archived_at был пуст): второй
      // крон, пришедший в то же время, магазин уже не трогает — ни файлы, ни
      // сообщение оператору второй раз.
      const { data: archived, error } = await serviceDb()
        .from("bots")
        .update({ archived_at: new Date(now).toISOString(), status: "suspended" })
        .eq("id", t.id)
        .is("archived_at", null)
        .select("id");
      if (error) throw new Error(error.message);
      if (!archived?.length) {
        results[t.id] = { skipped: "уже архивирован" };
        continue;
      }
      let removed = 0;
      for (const bucket of BUCKETS) {
        const keys = await listTenantKeys(bucket, t.id);
        for (let i = 0; i < keys.length; i += 100) {
          const { error: e } = await serviceDb()
            .storage.from(bucket)
            .remove(keys.slice(i, i + 100));
          if (e) throw new Error(`${bucket}: ${e.message}`);
          removed += Math.min(100, keys.length - i);
        }
      }
      if (t.telegramTokenEnc) {
        const { tenantContext } = await import("@/core/tenant/resolve.server");
        const { adminTelegramApi } = await import("@/channels/telegram/notify");
        await adminTelegramApi(tenantContext(t))
          ?.call("deleteWebhook", { drop_pending_updates: true })
          .catch(() => undefined);
      }
      results[t.id] = { archived: true, filesRemoved: removed };
      await alertOperator(
        `🗑 Магазин «${t.name}» (${t.id}) удалён по запросу владельца: в архиве, файлов удалено ${removed}. Заказы в базе сохранены.`,
      );
    } catch (e) {
      results[t.id] = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  invalidateTenantDirectory();
  return results;
}
