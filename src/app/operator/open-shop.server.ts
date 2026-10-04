import { randomBytes } from "node:crypto";
import { SITE_URL } from "@/app/landing/config";
import { serviceDb } from "@/core/db/client.server";
import { serverFailure } from "@/lib/server-failure";
import { OPEN_SOURCE, parseRequestMarker } from "@/core/marketplace/open-request";
import { welcomeText } from "@/core/marketplace/open-texts";
import { setLeadStage } from "./leads.server";

/**
 * «Создать магазин» из заявки с площадки (В19): одной кнопкой оператор получает магазин
 * по шаблону ниши — клиент, тариф из заявки, категории и скрытые примеры товаров. Лид
 * сначала «берётся» условной сменой стадии на «Клиент»: двойной клик или две вкладки
 * создадут один магазин. Не получилось создать — стадия возвращается. Деньги не
 * списываются: оплата, как сейчас, по счёту.
 */
export type OpenedShop = {
  botId: string;
  shopUrl: string;
  adminUrl: string;
  login: string;
  /** Показывается один раз: в базе остаётся только хеш. */
  password: string;
  /** Готовое сообщение заявителю на его языке. */
  welcome: string;
  /** Что не получилось из второстепенного (тариф, шаблон): магазин при этом создан. */
  warnings: string[];
};

export type OpenShopResult =
  | { ok: true; shop: OpenedShop }
  | { ok: false; reason: "not_found" | "not_request" | "changed" }
  | { ok: false; reason: "failed"; message: string };

export async function openShopFromLead(leadId: string, actor: string): Promise<OpenShopResult> {
  const db = serviceDb();
  const { data: lead, error } = await db
    .from("sales_leads")
    .select("id, stage, source, business_name, phone, email, instagram_handle, signals")
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw serverFailure(`заявка не прочитана: ${error.message}`);
  if (!lead) return { ok: false, reason: "not_found" };
  const request = parseRequestMarker(lead.signals);
  if (lead.source !== OPEN_SOURCE || !request) return { ok: false, reason: "not_request" };
  if (lead.stage === "converted") return { ok: false, reason: "changed" };

  const claimed = await setLeadStage({ id: lead.id, from: lead.stage, to: "converted" }, actor);
  if (!claimed.ok)
    return { ok: false, reason: claimed.reason === "not_found" ? "not_found" : "changed" };

  const ownerId = `shop-${lead.id.replace(/-/g, "").slice(0, 8)}`;
  const password = randomBytes(9).toString("base64url");
  const warnings: string[] = [];
  let botId: string;
  try {
    const { createClient } = await import("./operator.server");
    botId = await createClient({
      name: lead.business_name,
      ownerId,
      vertical: request.vertical,
      ownerName: lead.business_name,
      ownerContact:
        lead.phone ??
        lead.email ??
        (lead.instagram_handle ? `@${lead.instagram_handle}` : undefined),
      admin: { username: ownerId, password },
      actor,
    });
  } catch (e) {
    // Магазин не создан — лид возвращается на прежнюю стадию (условно: чужую смену не затираем).
    await db
      .from("sales_leads")
      .update({ stage: lead.stage, updated_at: new Date().toISOString() })
      .eq("id", lead.id)
      .eq("stage", "converted");
    return { ok: false, reason: "failed", message: e instanceof Error ? e.message : String(e) };
  }

  try {
    await (
      await import("./plans.server")
    ).setPlan(botId, { tier: request.tier, period: "month", addons: [] }, actor);
  } catch (e) {
    warnings.push(`Тариф не поставлен: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    const { requireTenant, tenantContext } = await import("@/core/tenant/resolve.server");
    const { applyNicheTemplate } = await import("@/core/templates/apply.server");
    await applyNicheTemplate(tenantContext(await requireTenant({ by: "id", value: botId })));
  } catch (e) {
    warnings.push(`Шаблон ниши не применён: ${e instanceof Error ? e.message : String(e)}`);
  }

  const { error: eventError } = await db.from("sales_lead_events").insert({
    lead_id: lead.id,
    actor,
    kind: "shop",
    detail: `Создан магазин ${ownerId}, тариф ${request.tier}`.slice(0, 500),
  });
  if (eventError) warnings.push(`Событие лида не записано: ${eventError.message}`);

  const shopUrl = `${SITE_URL}/s/${ownerId}`;
  const adminUrl = `${SITE_URL}/admin/login`;
  return {
    ok: true,
    shop: {
      botId,
      shopUrl,
      adminUrl,
      login: ownerId,
      password,
      welcome: welcomeText(request.locale, {
        name: lead.business_name,
        shopUrl,
        adminUrl,
        login: ownerId,
        password,
      }),
      warnings,
    },
  };
}
