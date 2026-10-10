import { getSettingsStrict, setSetting } from "@/core/settings/settings";
import { servedByV2 } from "@/core/tenant/directory";
import { requireTenant, tenantContext } from "@/core/tenant/resolve.server";
import { logEvent } from "./client-log.server";

/**
 * Курс Продамуса продавца (₸ за 1 ₽) из карточки клиента: по нему бот
 * показывает рубли рядом с тенге («1700 ₸ / ≈476 ₽») и считает рублёвые
 * заказы для формы *.kz. Раньше его ставил только продавец в «Настройки →
 * Оплата»; у Копилки висел устаревший 5,23 (Яков, 10.10).
 */
export type ProdamusRateState = {
  servedByV2: boolean;
  enabled: boolean;
  formUrl: string | null;
  rate: string | null;
};

export async function prodamusRateState(botId: string): Promise<ProdamusRateState> {
  const tenant = await requireTenant({ by: "id", value: botId });
  if (!servedByV2(tenant)) return { servedByV2: false, enabled: false, formUrl: null, rate: null };
  const s = await getSettingsStrict(tenantContext(tenant), [
    "prodamus_enabled",
    "prodamus_form_url",
    "prodamus_rate",
  ]);
  return {
    servedByV2: true,
    enabled: s.prodamus_enabled === "true",
    formUrl: s.prodamus_form_url?.trim() || null,
    rate: s.prodamus_rate?.trim() || null,
  };
}

/** Пустое значение стирает курс: тогда рубли рядом с тенге не показываются. */
export async function setProdamusRate(botId: string, raw: string, actor: string): Promise<void> {
  const tenant = await requireTenant({ by: "id", value: botId });
  // Клиента прежней платформы v2 не трогает: его заказы идут через v1.
  if (!servedByV2(tenant)) throw new Error("Клиента пока обслуживает v1.");
  const value = raw.trim().replace(",", ".");
  if (value !== "" && !(Number(value) > 0 && Number(value) < 1000))
    throw new Error("Курс — число больше нуля, например 3.573.");
  await setSetting(tenantContext(tenant), "prodamus_rate", value);
  await logEvent(botId, "payment", { action: "prodamus_rate", rate: value || null }, actor);
}
