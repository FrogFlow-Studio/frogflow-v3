import { env } from "@/config/env";
import { pageAll } from "@/core/db/page";
import { requireTenant, tenantContext } from "@/core/tenant/resolve.server";
import { getSettingsStrict, setSetting } from "@/core/settings/settings";
import { pricelistMode } from "@/core/consultant/pricelist/mode";
import { MODEL_KEY, PRICELIST_MODELS } from "@/core/consultant/pricelist/engine.server";
import { DEFAULT_MODEL } from "@/core/consultant/engine.server";
import { modelChoice, modelWeek } from "@/core/consultant/model-choice";
import { consultantOverview } from "@/app/admin/workspace.server";
import { UserError } from "@/core/i18n/user-error";
import { LAST_ERROR_KEY, isTransientFailure, parseLastError } from "./consultant-alerts";
import { logEvent } from "./operator.server";

/**
 * Консультант по прайсу (BOVI) глазами оператора: та же сводка, что у
 * продавца на «Обзоре» (передачи, последняя ошибка, свежесть прайса и курса),
 * плюс модель — выбранная и фактическая — и цена хода по моделям за 7 дней.
 * Яков видит сбои клиента сам, а не по жалобе. Только чтение, кроме выбора модели.
 */

/** Модель платформы: на ней консультант отвечает, если в настройке ничего верного. */
export function platformModel(): string {
  return env().CONSULTANT_MODEL?.trim() || DEFAULT_MODEL;
}

export async function consultantOperatorView(botId: string, now = new Date()) {
  const t = await requireTenant({ by: "id", value: botId });
  if (!pricelistMode(t)) return null;
  const ctx = tenantContext(t);
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const [overview, s, runs] = await Promise.all([
    consultantOverview(ctx, { contacts: true }, now),
    getSettingsStrict(ctx, [MODEL_KEY, LAST_ERROR_KEY]),
    pageAll(
      (from, to) =>
        ctx.db
          .from("consultant_message_runs")
          .select("id, model, token_usage")
          .gte("received_at", since)
          .not("model", "is", null)
          .order("received_at")
          .order("id")
          .range(from, to),
      "журнал ответов консультанта",
    ),
  ]);
  const lastError = parseLastError(s[LAST_ERROR_KEY]);
  return {
    overview,
    model: {
      ...modelChoice(s[MODEL_KEY], PRICELIST_MODELS, platformModel()),
      options: [...PRICELIST_MODELS],
      platform: platformModel(),
    },
    week: modelWeek(runs),
    lastError: lastError ? { ...lastError, transient: isTransientFailure(lastError.detail) } : null,
  };
}

/** Модель консультанта по прайсу: из проверенного списка или "" — модель платформы. */
export async function setConsultantModel(botId: string, model: string, actor = "operator") {
  if (model !== "" && !(PRICELIST_MODELS as readonly string[]).includes(model))
    throw new Error("Такой модели нет в проверенном списке.");
  const t = await requireTenant({ by: "id", value: botId });
  if (!pricelistMode(t))
    throw new UserError(
      "err.pricelist.off",
      "Консультант по прайсу у магазина не включён — его включает оператор.",
    );
  await setSetting(tenantContext(t), MODEL_KEY, model);
  await logEvent(botId, "meta", { consultant_model: model || "platform" }, actor);
}
