import { useEffect, useRef, useState } from "react";
import { productPickerFn } from "@/app/admin/products.functions";
import type { AdminT } from "@/app/i18n/admin";
import { ErrorBox, useAction } from "@/app/ui";
import { PICKER_LIMIT, type PickerProduct } from "@/core/catalog/picker";

export type { PickerProduct };

/**
 * Поиск товара по названию для форм админки (core/catalog/picker): весь
 * каталог в выпадающий список не грузим, у крупного магазина он в сотни
 * позиций. Пустой запрос показывает первые товары по алфавиту.
 */
export function ProductSearch({
  t,
  onPick,
  exclude = [],
  autoFocus,
}: {
  t: AdminT;
  onPick: (p: PickerProduct) => void;
  exclude?: readonly string[];
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<PickerProduct[] | null>(null);
  // Ответы приходят не по порядку: показываем только ответ на последний запрос.
  const latest = useRef(0);
  const search = useAction(async (q: string) => {
    const n = ++latest.current;
    const r = await productPickerFn({ data: { q, exclude: [...exclude].slice(0, 50) } });
    if (n === latest.current) setFound(r);
  });
  const excludeKey = exclude.join(",");
  useEffect(() => {
    const timer = setTimeout(() => void search.run(query).catch(() => {}), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, excludeKey]);
  return (
    <div className="space-y-1">
      <input
        className="input"
        type="search"
        value={query}
        autoFocus={autoFocus}
        placeholder={t("picker.search")}
        onChange={(e) => setQuery(e.target.value)}
        // Поле стоит внутри чужих форм (карточка товара, предложение): Enter их не отправляет.
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
        }}
      />
      {found && (
        <div className="max-h-56 overflow-auto rounded-md border border-line">
          {found.length === 0 ? (
            <p className="p-2 text-sm text-muted">{t("picker.nothing")}</p>
          ) : (
            found.map((p) => (
              <button
                key={p.id}
                type="button"
                className="block w-full truncate px-2 py-1.5 text-left text-sm hover:bg-surface-2"
                onClick={() => onPick(p)}
              >
                {p.name}
              </button>
            ))
          )}
          {found.length >= PICKER_LIMIT && (
            <p className="p-2 text-xs text-muted">{t("picker.more", { n: PICKER_LIMIT })}</p>
          )}
        </div>
      )}
      <ErrorBox error={search.error} />
    </div>
  );
}

/** Один товар: выбранный показан названием с кнопкой «Сменить», иначе — поиск. */
export function ProductPicker({
  t,
  value,
  onChange,
  exclude,
}: {
  t: AdminT;
  value: PickerProduct | null;
  onChange: (p: PickerProduct | null) => void;
  exclude?: readonly string[];
}) {
  if (value)
    return (
      <div className="flex items-center gap-2 rounded-md border border-line px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm">{value.name}</span>
        <button type="button" className="btn-ghost text-xs" onClick={() => onChange(null)}>
          {t("picker.change")}
        </button>
      </div>
    );
  return <ProductSearch t={t} onPick={onChange} exclude={exclude} />;
}
