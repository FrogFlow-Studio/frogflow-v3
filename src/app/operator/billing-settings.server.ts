import { serviceDb } from "@/core/db/client.server";
import { serverFailure } from "@/lib/server-failure";

/** Реквизиты для выплат и ссылка Kaspi Pay. */
const REQUISITES_KEY = "payout_requisites";

export async function getPayoutRequisites(): Promise<string> {
  const { data, error: readErr4 } = await serviceDb()
    .from("operator_settings")
    .select("value")
    .eq("key", REQUISITES_KEY)
    .maybeSingle();
  if (readErr4) throw serverFailure(`[billing] реквизиты не прочитаны: ${readErr4.message}`);
  return data?.value ?? "";
}

async function setOperatorSetting(key: string, value: string): Promise<void> {
  const db = serviceDb();
  const v = value.trim();
  const { data, error: readErr3 } = await db
    .from("operator_settings")
    .select("key")
    .eq("key", key)
    .maybeSingle();
  if (readErr3) throw serverFailure(`[billing] настройка не прочитана: ${readErr3.message}`);
  const { error } = data
    ? await db.from("operator_settings").update({ value: v }).eq("key", key)
    : await db.from("operator_settings").insert({ key, value: v });
  if (error) throw serverFailure(`Не удалось сохранить настройку: ${error.message}`);
}

export async function setPayoutRequisites(value: string): Promise<void> {
  await setOperatorSetting(REQUISITES_KEY, value);
}

/** Получатель в чеке Kaspi для автопроверки чеков за подписку. */
export async function setPayoutRecipient(value: string): Promise<void> {
  const { RECIPIENT_KEY } = await import("@/core/billing/invoice-check.server");
  await setOperatorSetting(RECIPIENT_KEY, value);
}

/** Ссылка Kaspi Pay платформы (core/billing/pay/kaspi-link); пусто — не задана. */
export async function getKaspiPayLink(): Promise<string> {
  const { KASPI_LINK_KEY } = await import("@/core/billing/pay/kaspi-link");
  const { data, error: readErr } = await serviceDb()
    .from("operator_settings")
    .select("value")
    .eq("key", KASPI_LINK_KEY)
    .maybeSingle();
  if (readErr) throw serverFailure(`[billing] ссылка Kaspi Pay не прочитана: ${readErr.message}`);
  return data?.value?.trim() ?? "";
}

export async function setKaspiPayLink(value: string): Promise<void> {
  const { KASPI_LINK_KEY, normalizeKaspiLink } = await import("@/core/billing/pay/kaspi-link");
  const link = value.trim() ? normalizeKaspiLink(value) : "";
  if (link === null)
    throw new Error("Ссылка Kaspi Pay должна начинаться с https:// и вести на kaspi.kz.");
  await setOperatorSetting(KASPI_LINK_KEY, link);
}
