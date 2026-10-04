import { bundleView, loadBundle } from "@/core/bundles/bundle";
import { bundleStock } from "@/core/bundles/stock";
import type { Locale } from "@/core/i18n/locale";
import { formatMoney } from "@/core/money/money";
import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * Набор в карточке товара для покупателя (модуль `bundles`): «В наборе: …»
 * списком и выгода. Только чтение, без разметки: каналы сами экранируют текст.
 * Предзаказ и лист ожидания для наборов в этой партии не предлагаем.
 */
export type BundleCardInfo = {
  /** Строки состава: «Шампунь (250 мл) × 2». */
  parts: string[];
  /** Выгода и цена по отдельности, готовым текстом; null — нет выгоды или цены не сопоставить. */
  saving: { amount: string; separate: string } | null;
  /** Все составляющие в продаже; иначе кнопок покупки нет. */
  available: boolean;
  /** Наборов из остатка составляющих; 0 — нет в наличии, null — предела нет или склад выключен. */
  capacity: number | null;
};

export const BUNDLE_CARD: Record<
  Locale,
  {
    contains: string;
    saving: (saving: string, separate: string) => string;
    unavailable: string;
  }
> = {
  ru: {
    contains: "В наборе:",
    saving: (s, o) => `💚 Выгода ${s} (по отдельности ${o})`,
    unavailable: "Набор временно недоступен",
  },
  kk: {
    contains: "Жинақта:",
    saving: (s, o) => `💚 Үнемдеу ${s} (бөлек ${o})`,
    unavailable: "Жинақ уақытша қолжетімсіз",
  },
  en: {
    contains: "In the set:",
    saving: (s, o) => `💚 You save ${s} (separately ${o})`,
    unavailable: "This set is temporarily unavailable",
  },
  uz: {
    contains: "To'plamda:",
    saving: (s, o) => `💚 Tejash ${s} (alohida ${o})`,
    unavailable: "To'plam vaqtincha mavjud emas",
  },
};

/** Набор → данные карточки; не набор или модуль выключен — null. */
export async function bundleCardInfo(
  ctx: TenantContext,
  productId: string,
): Promise<BundleCardInfo | null> {
  if (!ctx.tenant.modules.bundles) return null;
  const items = await loadBundle(ctx, productId);
  if (!items) return null;
  const view = await bundleView(ctx, productId, items);
  if (!view) return null;
  const parts = view.items
    .filter((i) => i.name)
    .map((i) => `${i.name}${i.variantName ? ` (${i.variantName})` : ""} × ${i.qty}`);
  const saving =
    view.saving != null && view.saving > 0 && view.separateTotal != null
      ? {
          amount: formatMoney(view.saving, view.currency),
          separate: formatMoney(view.separateTotal, view.currency),
        }
      : null;
  return {
    parts,
    saving,
    available: view.available,
    capacity: ctx.tenant.modules.stock ? await bundleStock(ctx, items) : null,
  };
}

/** Текст блока набора: состав, выгода, при недоступности — пометка. Строки без разметки. */
export function bundleCardLines(info: BundleCardInfo, locale: Locale): string[] {
  const m = BUNDLE_CARD[locale];
  const lines = [m.contains, ...info.parts.map((p) => `• ${p}`)];
  if (info.saving) lines.push(m.saving(info.saving.amount, info.saving.separate));
  if (!info.available) lines.push(`⚠️ ${m.unavailable}`);
  return lines;
}
