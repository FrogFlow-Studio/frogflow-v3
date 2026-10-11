import { HelpTip } from "@/app/admin/help-panel";
import { useState } from "react";
import { saveCostFn } from "@/app/admin/cost.functions";
import type { AdminT } from "@/app/i18n/admin";
import { ErrorBox, Field, useAction } from "@/app/ui";
import { parseAmountInput, type ProductCost } from "@/core/profit/cost";

export type CostVariant = { name: string };

const show = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

/**
 * Поля себестоимости одного товара: сумма на товар и, если есть варианты, на
 * каждый вариант. На сервер уходят только изменённые поля — правка в соседней
 * вкладке других полей не затирается (core/profit/cost, слияние).
 */
export function CostEditor({
  productId,
  variants,
  cost,
  currency,
  canWrite,
  t,
  onSaved,
}: {
  productId: string;
  variants: CostVariant[];
  cost: ProductCost | null;
  currency: string;
  canWrite: boolean;
  t: AdminT;
  onSaved?: (cost: ProductCost | null) => void;
}) {
  const [saved, setSaved] = useState(cost);
  const [price, setPrice] = useState(show(cost?.price));
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(variants.map((v) => [v.name, show(cost?.variants[v.name])])),
  );
  const [done, setDone] = useState(false);
  const priceN = parseAmountInput(price);
  const parsed = variants.map((v) => [v.name, parseAmountInput(vals[v.name] ?? "")] as const);
  const invalid = priceN === "invalid" || parsed.some(([, n]) => n === "invalid");
  const was = (name: string) => saved?.variants[name] ?? null;
  const changedVariants = parsed.filter(([name, n]) => n !== "invalid" && n !== was(name));
  const priceChanged = priceN !== "invalid" && priceN !== (saved?.price ?? null);
  const dirty = priceChanged || changedVariants.length > 0;
  const save = useAction(async () => {
    setDone(false);
    const r = await saveCostFn({
      data: {
        id: productId,
        ...(priceChanged ? { price: priceN as number | null } : {}),
        ...(changedVariants.length
          ? {
              variants: Object.fromEntries(
                changedVariants.map(([name, n]) => [name, n as number | null]),
              ),
            }
          : {}),
      },
    });
    setSaved(r.cost);
    setDone(true);
    onSaved?.(r.cost);
  });
  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <Field
          label={t("cost.price", { cur: currency })}
          hint={t("cost.priceHint")}
          help={<HelpTip article="cost" anchor="cost" />}
        >
          <input
            className={`input w-36 ${priceN === "invalid" ? "border-danger" : ""}`}
            inputMode="decimal"
            value={price}
            placeholder={t("cost.notSet")}
            disabled={!canWrite}
            onChange={(e) => setPrice(e.target.value)}
            aria-label={t("cost.price", { cur: currency })}
          />
        </Field>
      </div>
      {variants.length > 0 && (
        <div className="mt-3">
          <p className="label">{t("cost.variants")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {variants.map((v) => (
              <label key={v.name} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{v.name}</span>
                <input
                  className={`input w-28 ${
                    parseAmountInput(vals[v.name] ?? "") === "invalid" ? "border-danger" : ""
                  }`}
                  inputMode="decimal"
                  value={vals[v.name] ?? ""}
                  placeholder={t("cost.sameAsProduct")}
                  disabled={!canWrite}
                  onChange={(e) => setVals({ ...vals, [v.name]: e.target.value })}
                  aria-label={`${t("cost.card")}: ${v.name}`}
                />
              </label>
            ))}
          </div>
        </div>
      )}
      {canWrite && (
        <div className="mt-3 flex items-center gap-3">
          <button
            className="btn-secondary"
            disabled={save.busy || invalid || !dirty}
            onClick={() => void save.run().catch(() => {})}
          >
            {t("common.save")}
          </button>
          {done && !dirty && <span className="text-xs text-ok">{t("cost.saved")}</span>}
        </div>
      )}
      <ErrorBox error={save.error} />
    </div>
  );
}
