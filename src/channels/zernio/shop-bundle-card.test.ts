import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { resetPricingCache } from "@/core/pricing/pricing";
import { resetOffersCache } from "@/core/offers/offers";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import { BUNDLE_CARD } from "@/core/bundles/card";
import { bundleShop, SET } from "../../../tests/bundle-shop";
import type { ParsedZernioMessage } from "./message";
import type { ZernioTransport } from "./api.server";
import { handleShopMessage } from "./shop.server";

function open(
  opts: {
    modules?: Record<string, boolean>;
    balmActive?: boolean;
    balmStock?: number;
    locale?: string;
  } = {},
) {
  const { ctx: base, db } = bundleShop({
    modules: opts.modules,
    balmActive: opts.balmActive,
    stock: { balm: opts.balmStock ?? null },
  });
  Object.assign(
    db.tables.products!.find((p) => p.id === SET)!,
    {
      description: null,
      lead_time_days: null,
      product_images: [],
      product_variants: [],
      product_material_files: [],
    },
  );
  db.tables.bot_users = [{ user_key: "ig_1", platform: "instagram", telegram_id: -1, state: {} }];
  const ctx = {
    ...base,
    tenant: { ...base.tenant, status: "active", vertical: "digital" },
    appUrl: "https://app.test",
  } as unknown as TenantContext;
  const sent: Array<{ text: string; buttons: Array<{ payload?: string }> }> = [];
  const transport = {
    send: vi.fn(async (_c: string, _a: string, text: string, o: { buttons?: [] } = {}) => {
      sent.push({ text, buttons: o.buttons ?? [] });
      return { ok: true };
    }),
    tail: vi.fn(async () => []),
  } as unknown as ZernioTransport;
  const customer = {
    userKey: "ig_1",
    platform: "instagram",
    telegramId: -1,
    state: { locale: opts.locale ?? "ru", mode: "idle" },
  } as unknown as Customer;
  return handleShopMessage(
    ctx,
    customer,
    {
      conversationId: "conv-1",
      accountId: "acc-1",
      platform: "instagram",
      text: "",
      postbackPayload: `PROD:${SET}`,
      nativeOrder: null,
      attachments: [],
    } as unknown as ParsedZernioMessage,
    transport,
  ).then(() => sent.at(-1)!);
}

const payloads = (b: Array<{ payload?: string }>) => b.map((x) => x.payload ?? "");

beforeEach(() => {
  resetOffersCache();
  resetPricingCache();
});

describe("карточка набора в Instagram/WhatsApp Direct", () => {
  it("состав списком, выгода и кнопка «В корзину» на каждом языке", async () => {
    for (const l of SUPPORTED_LOCALES) {
      const card = await open({ locale: l });
      expect(card.text).toContain(BUNDLE_CARD[l].contains);
      expect(card.text).toContain("• Шампунь × 2");
      expect(payloads(card.buttons)).toContain(`BUY:${SET}`);
    }
  });

  it("набор без остатка: нет кнопки «Сообщить о поступлении»", async () => {
    const card = await open({
      modules: { bundles: true, stock: true, waitlist: true },
      balmStock: 0,
    });
    expect(payloads(card.buttons).some((p) => p.startsWith("WAIT:"))).toBe(false);
    expect(payloads(card.buttons).some((p) => p.startsWith("BUY:"))).toBe(false);
    expect(card.text).toContain("Нет в наличии");
  });

  it("скрытый компонент — без «В корзину», с пометкой", async () => {
    const card = await open({ balmActive: false });
    expect(payloads(card.buttons).some((p) => p.startsWith("BUY:"))).toBe(false);
    expect(card.text).toContain("Набор временно недоступен");
  });
});
