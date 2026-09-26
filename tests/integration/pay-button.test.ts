import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { liveReady, DEMO_BOT } from "./live";
import { serviceDb } from "@/core/db/client.server";
import type { Json } from "@/core/db-types";

/**
 * Кнопка «Оплатить» у владельца против настоящей базы на «Демо-тестере»:
 * первое нажатие заводит счёт по плану со ссылкой и QR Kaspi Pay, второе
 * берёт тот же открытый счёт, без ссылки — реквизиты перевода. Ссылка Kaspi
 * Pay общая для платформы (operator_settings), поэтому в базе её не трогаем:
 * тест подставляет её через способ оплаты и чтение настройки.
 */
const LINK = { value: "https://pay.kaspi.kz/pay/v2-pay-button-test" };

vi.mock("@/core/billing/pay/kaspi-link", async (orig) => {
  const m = await orig<typeof import("@/core/billing/pay/kaspi-link")>();
  return { ...m, kaspiLinkProvider: () => m.kaspiLinkProvider(async () => LINK.value) };
});
vi.mock("@/app/operator/billing.server", async (orig) => {
  const m = await orig<typeof import("@/app/operator/billing.server")>();
  return { ...m, getKaspiPayLink: async () => LINK.value };
});

const ACTOR = "v2-pay-button-test";
let before: { billing: Json | undefined; plan: string | null };
const invoiceIds: string[] = [];

async function cleanup() {
  const db = serviceDb();
  if (invoiceIds.length) {
    await db
      .from("bot_events")
      .delete()
      .eq("bot_id", DEMO_BOT)
      .in("payload->>invoice_id", invoiceIds);
    await db.from("subscription_invoices").delete().in("id", invoiceIds);
  }
  await db.from("bot_events").delete().eq("bot_id", DEMO_BOT).eq("actor", ACTOR);
}

describe.skipIf(!liveReady)("кнопка «Оплатить» на демо-клиенте", () => {
  beforeAll(async () => {
    const { data } = await serviceDb()
      .from("bots")
      .select("settings, subscription_plan")
      .eq("id", DEMO_BOT)
      .single();
    const settings = (data?.settings ?? {}) as { billing?: Record<string, unknown> };
    before = {
      billing: settings.billing as Json | undefined,
      plan: data?.subscription_plan ?? null,
    };
    const { count } = await serviceDb()
      .from("subscription_invoices")
      .select("id", { count: "exact", head: true })
      .eq("bot_id", DEMO_BOT)
      .eq("status", "sent");
    // Чужой открытый счёт демо-клиента подменил бы «тот же счёт» в проверке.
    expect(count ?? 0).toBe(0);
    const { patchTenantSettings, invalidateTenantDirectory } =
      await import("@/core/tenant/resolve.server");
    await patchTenantSettings(DEMO_BOT, {
      billing: { ...(settings.billing ?? {}), plan: "digital.basic", period: "month" },
    });
    invalidateTenantDirectory();
  });

  afterAll(async () => {
    await cleanup();
    const { data } = await serviceDb().from("bots").select("settings").eq("id", DEMO_BOT).single();
    const settings = { ...(data?.settings as Record<string, unknown>) };
    if (before.billing === undefined) delete settings.billing;
    else settings.billing = before.billing;
    await serviceDb()
      .from("bots")
      .update({ settings: settings as Json, subscription_plan: before.plan })
      .eq("id", DEMO_BOT);
    const { invalidateTenantDirectory } = await import("@/core/tenant/resolve.server");
    invalidateTenantDirectory();
  });

  it("первое нажатие: счёт по плану, ссылка Kaspi и QR с ней", async () => {
    const { ownerPayInvoice } = await import("@/app/operator/plans.server");
    const { qrSvg } = await import("@/core/billing/pay/kaspi-link");
    const r = await ownerPayInvoice(DEMO_BOT, ACTOR);
    invoiceIds.push(r.invoiceId);
    expect(r.reused).toBe(false);
    expect(r.currency).toBe("KZT");
    // Basic за месяц + подключение (ещё не оплачено).
    expect(r.amount).toBe(9_900 + 15_000);
    expect(r.payUrl).toBe(LINK.value);
    expect(r.requisites).toBeNull();
    expect(qrSvg(r.payUrl!)).toMatch(/^<svg[\s\S]*<\/svg>$/);

    const { data: inv } = await serviceDb()
      .from("subscription_invoices")
      .select("status, amount, bot_id")
      .eq("id", r.invoiceId)
      .single();
    expect(inv).toMatchObject({ status: "sent", bot_id: DEMO_BOT });
    expect(Number(inv?.amount)).toBe(r.amount);
    const { data: bot } = await serviceDb()
      .from("bots")
      .select("settings")
      .eq("id", DEMO_BOT)
      .single();
    const billing = (bot?.settings as { billing?: Record<string, unknown> }).billing;
    expect(billing?.connection_invoice_id).toBe(r.invoiceId);
  });

  it("повторное нажатие берёт тот же открытый счёт, второго не заводит", async () => {
    const { ownerPayInvoice } = await import("@/app/operator/plans.server");
    const r = await ownerPayInvoice(DEMO_BOT, ACTOR);
    expect(r.reused).toBe(true);
    expect(r.invoiceId).toBe(invoiceIds[0]);
    expect(r.payUrl).toBe(LINK.value);
    const { count } = await serviceDb()
      .from("subscription_invoices")
      .select("id", { count: "exact", head: true })
      .eq("bot_id", DEMO_BOT)
      .eq("status", "sent");
    expect(count).toBe(1);
  });

  it("без ссылки Kaspi тот же счёт показывается реквизитами перевода", async () => {
    const { ownerPayInvoice } = await import("@/app/operator/plans.server");
    const { getPayoutRequisites } = await import("@/app/operator/billing.server");
    LINK.value = "";
    try {
      const r = await ownerPayInvoice(DEMO_BOT, ACTOR);
      expect(r.invoiceId).toBe(invoiceIds[0]);
      expect(r.payUrl).toBeNull();
      expect(r.requisites).toBe(await getPayoutRequisites());
    } finally {
      LINK.value = "https://pay.kaspi.kz/pay/v2-pay-button-test";
    }
  });
});
