import { applyShopKindFn } from "@/app/admin/shop.functions";
import { type AdminT } from "@/app/i18n/admin";
import { Card, ErrorBox, useAction } from "@/app/ui";

/** Карточка вида магазина. */

/** Шаблон магазина по типу (Р2): три кнопки, только пока магазин пуст. */
export function ShopKindCard({ t, onDone }: { t: AdminT; onDone: () => Promise<void> }) {
  const apply = useAction(async (kind: "digital" | "goods" | "services") => {
    if (!confirm(t("shopKind.confirm"))) return;
    await applyShopKindFn({ data: { kind } });
    await onDone();
  });
  const kinds = [
    ["digital", "shopKind.digital", "shopKind.digitalHint"],
    ["goods", "shopKind.goods", "shopKind.goodsHint"],
    ["services", "shopKind.services", "shopKind.servicesHint"],
  ] as const;
  return (
    <Card title={t("shopKind.title")} className="mb-4">
      <p className="mb-3 text-sm text-muted" data-testid="shop-kind-card">
        {t("shopKind.intro")}
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        {kinds.map(([kind, title, hint]) => (
          <button
            key={kind}
            type="button"
            className="btn-secondary h-auto flex-col items-start gap-1 whitespace-normal p-3 text-left"
            disabled={apply.busy}
            onClick={() => void apply.run(kind).catch(() => {})}
          >
            <span className="font-medium">{t(title)}</span>
            <span className="text-xs text-muted">{t(hint)}</span>
          </button>
        ))}
      </div>
      <ErrorBox error={apply.error} />
    </Card>
  );
}
