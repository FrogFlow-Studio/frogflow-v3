import type { AdminT } from "@/app/i18n/admin";
import type { Readiness } from "@/core/catalog/readiness";
import { Card } from "@/app/ui";

/** «цена, 2 фото» — чего не хватает; пусто, если карточка готова. */
export function readinessGaps(r: Readiness, t: AdminT): string {
  return r.missing
    .map((g) =>
      g.key === "photos"
        ? t("product.ready.k.photos", { n: g.count ?? 0 })
        : t(`product.ready.k.${g.key}`),
    )
    .join(", ");
}

/** «Не хватает: цена, 2 фото» или «Всё на месте». */
export function readinessLine(r: Readiness, t: AdminT): string {
  return r.ready
    ? t("product.ready.ok")
    : t("product.ready.missing", { list: readinessGaps(r, t) });
}

export function ReadinessCard({ r, t }: { r: Readiness; t: AdminT }) {
  return (
    <Card title={t("product.ready.title")}>
      <div
        role="progressbar"
        aria-valuenow={r.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 overflow-hidden rounded-full bg-line"
      >
        <div
          className={`h-full ${r.ready ? "bg-ok" : "bg-accent"}`}
          style={{ width: `${r.percent}%` }}
        />
      </div>
      <p className="mt-2 text-sm" data-testid="product-readiness">
        {readinessLine(r, t)}
      </p>
    </Card>
  );
}
