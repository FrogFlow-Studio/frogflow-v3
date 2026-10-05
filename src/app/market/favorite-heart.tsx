import { useEffect, useState } from "react";
import { favoriteKey } from "@/core/marketplace/favorites";
import type { Locale } from "@/core/i18n/locale";
import { favoriteT } from "./favorite-i18n";
import { marketFavoriteFn, marketFavoriteKeysFn } from "./buyer.functions";

/** Состояние сердечек на странице: ключи «магазин:товар» из браузера, публичную страницу это не кэшируется. */
export function useFavorites() {
  const [keys, setKeys] = useState<ReadonlySet<string>>(new Set());
  const [ready, setReady] = useState(true);
  useEffect(() => {
    let alive = true;
    marketFavoriteKeysFn()
      .then((r) => alive && setKeys(new Set(r.keys)))
      .catch(() => alive && setReady(false));
    return () => {
      alive = false;
    };
  }, []);
  return { keys, setKeys, ready };
}

/** Сердечко у товара: отметить / снять; без входа подсказывает, как войти. */
export function FavoriteHeart({
  shopId,
  productId,
  locale,
  keys,
  setKeys,
}: {
  shopId: string;
  productId: string;
  locale: Locale;
  keys: ReadonlySet<string>;
  setKeys: (k: ReadonlySet<string>) => void;
}) {
  const t = favoriteT(locale);
  const key = favoriteKey(shopId, productId);
  const on = keys.has(key);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await marketFavoriteFn({ data: { shopId, productId, on: !on } });
      if (r.status === "signin") setNote(t("signin"));
      else if (r.status === "soon") setNote(t("soon"));
      else if (r.status === "unknown") setNote(t("unknown"));
      else if (r.status === "full") setNote(t("full", { n: 200 }));
      else {
        const next = new Set(keys);
        if (r.status === "removed") next.delete(key);
        else next.add(key);
        setKeys(next);
      }
    } catch {
      setNote(t("failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <button
        type="button"
        aria-pressed={on}
        aria-label={on ? t("remove") : t("add")}
        title={on ? t("remove") : t("add")}
        disabled={busy}
        onClick={() => void toggle()}
        className="text-lg leading-none"
      >
        {on ? "♥" : "♡"}
      </button>
      {note && (
        <p role="status" className="mt-1 text-xs text-muted">
          {note}
        </p>
      )}
    </div>
  );
}
