import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { parseFavorites, pruneFavorites, toggleFavorite } from "@/core/storefront/favorites";

/** Избранное витрины: в браузере покупателя, по магазину; сервер его не видит (core/storefront/favorites). */
type FavoritesApi = {
  ids: string[];
  /** Список уже прочитан из браузера (до этого он пуст не потому, что избранного нет). */
  ready: boolean;
  has: (id: string) => boolean;
  toggle: (id: string) => void;
  /** Оставить только живые товары — после ответа сервера на странице «Избранное». */
  keepOnly: (alive: Iterable<string>) => void;
};

const Ctx = createContext<FavoritesApi | null>(null);

export function FavoritesProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const key = `ff-fav-${slug}`;
  const [ids, setIds] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      setIds(parseFavorites(localStorage.getItem(key)));
    } catch {
      /* пусто */
    }
    setReady(true);
  }, [key]);
  const persist = useCallback(
    (next: string[]) => {
      setIds(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* приватный режим */
      }
    },
    [key],
  );
  const api = useMemo<FavoritesApi>(
    () => ({
      ids,
      ready,
      has: (id) => ids.includes(id),
      toggle: (id) => persist(toggleFavorite(ids, id)),
      keepOnly: (alive) => {
        const next = pruneFavorites(ids, alive);
        if (next.length !== ids.length) persist(next);
      },
    }),
    [ids, ready, persist],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useFavorites(): FavoritesApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("FavoritesProvider не найден");
  return v;
}

/** «♡/♥» на карточке и странице товара. */
export function FavoriteButton({
  id,
  addLabel,
  removeLabel,
  className = "",
}: {
  id: string;
  addLabel: string;
  removeLabel: string;
  className?: string;
}) {
  const fav = useFavorites();
  const on = fav.has(id);
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? removeLabel : addLabel}
      title={on ? removeLabel : addLabel}
      onClick={() => fav.toggle(id)}
      className={`flex h-9 w-9 items-center justify-center rounded-full bg-surface/90 text-lg leading-none backdrop-blur ${on ? "text-danger" : "text-muted"} ${className}`}
    >
      {on ? "♥" : "♡"}
    </button>
  );
}
