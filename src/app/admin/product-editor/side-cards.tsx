import { ProductSearch } from "@/app/admin/product-picker";
import { useEffect, useState } from "react";
import { saveUpsellFn, upsellForProductFn } from "@/app/admin/upsell.functions";
import {
  productPreviewFn,
  productSubscriptionFn,
  saveProductPreviewFn,
  saveProductSubscriptionFn,
} from "@/app/admin/products.functions";
import { type AdminT } from "@/app/i18n/admin";
import { CostEditor } from "@/app/admin/cost-editor";
import { productCostFn } from "@/app/admin/cost.functions";
import { productSupplierFn, setProductSupplierFn } from "@/app/admin/warehouse.functions";
import type { ProductCost } from "@/core/profit/cost";
import { assistDescriptionFn } from "@/app/admin/assistant.functions";
import { Card, ErrorBox, Field, useAction } from "@/app/ui";
import { imagePath } from "@/core/catalog/image-url";
import { upload } from "./parts";

/** «С этим предлагать»: до 10 товаров, которые бот покажет в корзине рядом с этим. */
export function UpsellCard({ productId, t }: { productId: string; t: AdminT }) {
  const [loaded, setLoaded] = useState(false);
  // state: в продаже, скрыт или удалён — скрытый и удалённый покупателю не предлагаются.
  const [picked, setPicked] = useState<
    Array<{ id: string; name: string | null; state: "ok" | "hidden" | "deleted" }>
  >([]);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void upsellForProductFn({ data: { productId } }).then((r) => {
      // Порядок — как сохранён; удалённый товар остаётся в списке с пометкой, чтобы его можно было убрать.
      setPicked(r.targets);
      setLoaded(true);
    });
  }, [productId]);
  const save = useAction(async () => {
    await saveUpsellFn({ data: { productId, ids: picked.map((x) => x.id) } });
    setSaved(true);
  });
  if (!loaded) return null;
  return (
    <Card title={t("product.card.upsell")}>
      <p className="mb-2 text-xs text-muted">{t("product.upsellHint")}</p>
      <ul className="mb-2 space-y-1 text-sm">
        {picked.map((x) => (
          <li key={x.id} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">
              {x.name ?? t("product.upsell.deletedName")}
              {x.state !== "ok" && (
                <span className="ml-2 text-xs text-warn">{t(`product.upsell.${x.state}`)}</span>
              )}
            </span>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => setPicked((p) => p.filter((y) => y.id !== x.id))}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      {picked.length < 10 && (
        <div aria-label={t("product.upsellAdd")}>
          <ProductSearch
            t={t}
            exclude={[productId, ...picked.map((x) => x.id)]}
            onPick={(x) =>
              setPicked((p) =>
                p.some((y) => y.id === x.id) || p.length >= 10
                  ? p
                  : [...p, { id: x.id, name: x.name, state: "ok" }],
              )
            }
          />
        </div>
      )}
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          className="btn-secondary"
          disabled={save.busy}
          onClick={() => {
            setSaved(false);
            void save.run().catch(() => {});
          }}
        >
          {t("common.save")}
        </button>
        {saved && <span className="text-xs text-ok">✓</span>}
      </div>
      <ErrorBox error={save.error} />
    </Card>
  );
}

/**
 * Черновик описания от ИИ: берёт из формы название, цену, ключевые слова и
 * то, что уже написано в описании, и кладёт текст в поле. Прежний текст
 * можно вернуть одной кнопкой; сохраняет продавец сам.
 */
export function DescriptionAssist({
  t,
  kind,
  currency,
}: {
  t: AdminT;
  kind: "digital" | "physical";
  currency: string;
}) {
  const [before, setBefore] = useState<string | null>(null);
  const field = (el: HTMLElement, name: string) =>
    el.closest("form")?.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null;
  const write = useAction(async (el: HTMLElement) => {
    const area = field(el, "description");
    if (!area) return;
    const { text } = await assistDescriptionFn({
      data: {
        name: field(el, "name")?.value ?? "",
        description: area.value,
        keywords: field(el, "keywords")?.value ?? "",
        price: Number(field(el, "price")?.value) || null,
        currency: field(el, "currency")?.value || currency,
        kind,
      },
    });
    setBefore(area.value);
    area.value = text;
  });
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-secondary text-sm"
          disabled={write.busy}
          onClick={(e) => void write.run(e.currentTarget).catch(() => {})}
        >
          {write.busy ? t("product.assist.busy") : t("product.assist.write")}
        </button>
        {before !== null && (
          <button
            type="button"
            className="btn-ghost text-sm"
            onClick={(e) => {
              const area = field(e.currentTarget, "description");
              if (area) area.value = before;
              setBefore(null);
            }}
          >
            {t("product.assist.undo")}
          </button>
        )}
      </div>
      <p className="text-xs text-muted">{t("product.assist.hint")}</p>
      <ErrorBox error={write.error} />
    </div>
  );
}

/** Пример цифрового товара: до 5 картинок — витрина и кнопка «👀 Пример» в боте. */
export function PreviewCard({
  productId,
  t,
  botId,
}: {
  productId: string;
  t: AdminT;
  botId: string;
}) {
  const [keys, setKeys] = useState<string[] | null>(null);
  useEffect(() => {
    void productPreviewFn({ data: { id: productId } }).then(setKeys);
  }, [productId]);
  const save = useAction(async (next: string[]) => {
    setKeys(await saveProductPreviewFn({ data: { id: productId, keys: next } }));
  });
  const add = useAction(async (files: FileList | null) => {
    if (!files?.length || !keys) return;
    const added: string[] = [];
    for (const f of [...files].slice(0, 5 - keys.length))
      added.push((await upload("image", f, t)).key);
    await save.run([...keys, ...added]);
  });
  if (!keys) return null;
  return (
    <Card title={t("product.card.preview")}>
      <p className="mb-2 text-xs text-muted">{t("product.previewHint")}</p>
      <div className="flex flex-wrap gap-2">
        {keys.map((k) => (
          <div key={k} className="relative">
            <img src={imagePath(botId, k)} alt="" className="h-20 w-20 rounded object-cover" />
            <button
              type="button"
              className="absolute -top-2 -right-2 rounded-full bg-danger px-1.5 text-xs text-white"
              onClick={() => void save.run(keys.filter((x) => x !== k)).catch(() => {})}
            >
              ✕
            </button>
          </div>
        ))}
        {keys.length < 5 && (
          <label className="btn-secondary flex h-20 w-20 cursor-pointer items-center justify-center text-xs">
            +
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(e) => void add.run(e.target.files).catch(() => {})}
            />
          </label>
        )}
      </div>
      <ErrorBox error={add.error ?? save.error} />
    </Card>
  );
}

/** Основной поставщик товара (core/stock/suppliers): список поставщиков — в разделе «Склад». */
export function SupplierCard({
  productId,
  canWrite,
  t,
}: {
  productId: string;
  canWrite: boolean;
  t: AdminT;
}) {
  const [state, setState] = useState<Awaited<ReturnType<typeof productSupplierFn>> | null>(null);
  useEffect(() => {
    void productSupplierFn({ data: { id: productId } }).then(setState);
  }, [productId]);
  const save = useAction(async (supplierId: string | null) => {
    const r = await setProductSupplierFn({ data: { id: productId, supplierId } });
    setState((s) => (s ? { ...s, current: r.supplierId } : s));
  });
  if (!state) return null;
  return (
    <Card title={t("product.supplier.card")}>
      {state.suppliers.length === 0 ? (
        <p className="text-sm text-muted">{t("product.supplier.empty")}</p>
      ) : (
        <Field label={t("product.supplier.card")} hint={t("product.supplier.hint")}>
          <select
            className="input"
            value={state.current ?? ""}
            disabled={!canWrite || save.busy}
            onChange={(e) => void save.run(e.target.value || null).catch(() => {})}
          >
            <option value="">{t("product.supplier.none")}</option>
            {state.suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <ErrorBox error={save.error} />
    </Card>
  );
}

/** Себестоимость товара и вариантов (core/profit/cost): из неё считается прибыль в аналитике. */
export function CostCard({
  productId,
  variantNames,
  canWrite,
  t,
}: {
  productId: string;
  variantNames: string[];
  canWrite: boolean;
  t: AdminT;
}) {
  const [state, setState] = useState<{ currency: string; cost: ProductCost | null } | null>(null);
  useEffect(() => {
    void productCostFn({ data: { id: productId } }).then(setState);
  }, [productId]);
  if (!state) return null;
  return (
    <Card title={t("cost.card")}>
      <CostEditor
        productId={productId}
        variants={variantNames.map((name) => ({ name }))}
        cost={state.cost}
        currency={state.currency}
        canWrite={canWrite}
        t={t}
      />
    </Card>
  );
}

/** Товар-подписка: раз в N дней бот напомнит покупателю продлить (core/catalog/subscription). */
export function SubscriptionCard({ productId, t }: { productId: string; t: AdminT }) {
  const [days, setDays] = useState<number | null | undefined>(undefined);
  const [draft, setDraft] = useState("30");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void productSubscriptionFn({ data: { id: productId } }).then((r) => {
      setDays(r.days);
      if (r.days) setDraft(String(r.days));
    });
  }, [productId]);
  const save = useAction(async (next: number | null) => {
    setSaved(false);
    const r = await saveProductSubscriptionFn({ data: { id: productId, days: next } });
    setDays(r.days);
    setSaved(true);
  });
  if (days === undefined) return null;
  const n = Number(draft);
  const valid = Number.isInteger(n) && n >= 7 && n <= 365;
  return (
    <Card title={t("product.card.subscription")}>
      <p className="mb-3 text-xs text-muted">{t("product.subscriptionHint")}</p>
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={days !== null}
          disabled={save.busy}
          onChange={(e) =>
            void save.run(e.target.checked ? (valid ? n : 30) : null).catch(() => {})
          }
        />
        {t("product.subscriptionOn")}
      </label>
      {days !== null && (
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("product.subscriptionDays")}>
            <input
              className="input w-28"
              type="number"
              min={7}
              max={365}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </Field>
          <button
            className="btn-secondary"
            disabled={save.busy || !valid || n === days}
            onClick={() => void save.run(n).catch(() => {})}
          >
            {t("common.save")}
          </button>
          {saved && <span className="text-xs text-ok">{t("settings.saved")}</span>}
        </div>
      )}
      <ErrorBox error={save.error} />
    </Card>
  );
}
