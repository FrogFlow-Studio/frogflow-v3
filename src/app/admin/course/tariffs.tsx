import { useEffect, useState } from "react";
import { courseVariantsFn } from "@/app/admin/courses.functions";
import type { AdminT } from "@/app/i18n/admin";
import { ACCESS_DAYS_MAX } from "@/core/courses/course";
import { DEFAULT_TARIFF, type Tariff } from "@/core/courses/cohort";

/** Тарифы курса. */

/** Тарифы — по вариантам товара: проверка ДЗ, канал, срок доступа. */
export function TariffsField({
  productId,
  tariffs,
  onChange,
  t,
}: {
  productId: string;
  tariffs: Record<string, Tariff>;
  onChange: (t: Record<string, Tariff>) => void;
  t: AdminT;
}) {
  const [variants, setVariants] = useState<Array<{ id: string; name: string }> | null>(null);
  useEffect(() => {
    void courseVariantsFn({ data: { productId } }).then(setVariants, () => setVariants([]));
  }, [productId]);
  if (!variants) return null;
  const set = (id: string, patch: Partial<Tariff>) =>
    onChange({ ...tariffs, [id]: { ...DEFAULT_TARIFF, ...tariffs[id], ...patch } });
  return (
    <div className="mb-3 space-y-2 text-sm">
      <p className="text-xs text-muted">{t("product.courseTariffs")}</p>
      {variants.length === 0 ? (
        <p className="text-xs text-muted">{t("product.courseTariffsNone")}</p>
      ) : (
        <>
          {variants.map((v) => {
            const cur = { ...DEFAULT_TARIFF, ...tariffs[v.id] };
            return (
              <div
                key={v.id}
                className="flex flex-wrap items-center gap-3 rounded border border-line p-2"
              >
                <span className="min-w-0 flex-1 font-medium">{v.name}</span>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={cur.homework}
                    onChange={(e) => set(v.id, { homework: e.target.checked })}
                  />
                  {t("product.tariffHomework")}
                </label>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={cur.channel}
                    onChange={(e) => set(v.id, { channel: e.target.checked })}
                  />
                  {t("product.tariffChannel")}
                </label>
                <label className="flex items-center gap-1 text-xs">
                  {t("product.tariffAccessDays")}
                  <input
                    type="number"
                    className="input w-20"
                    min={1}
                    max={ACCESS_DAYS_MAX}
                    value={cur.accessDays ?? ""}
                    onChange={(e) => {
                      const n = Math.round(Number(e.target.value));
                      set(v.id, {
                        accessDays: e.target.value && n >= 1 ? Math.min(n, ACCESS_DAYS_MAX) : null,
                      });
                    }}
                  />
                </label>
              </div>
            );
          })}
          <p className="text-xs text-muted">{t("product.courseTariffsHint")}</p>
        </>
      )}
    </div>
  );
}
