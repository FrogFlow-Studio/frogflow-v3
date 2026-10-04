import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { webFavoritesSyncFn } from "@/app/storefront/tg-login.functions";
import { parseFavorites, pruneFavorites, toggleFavorite } from "@/core/storefront/favorites";

/**
 * Избранное витрины: в браузере покупателя, по магазину. Вошедший через
 * Telegram покупатель получает его и на других устройствах: при открытии
 * сохранённое складывается с браузерным, после сердечка уходит весь список
 * (core/storefront/favorites-sync). Не вошёл — сервер списка не видит.
 */
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
  const idsRef = useRef<string[]>([]);
  // Сложение с сохранённым списком ещё идёт: до его конца «заменить» не шлём, иначе затрёт сохранённое.
  const merging = useRef(true);
  const touched = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const store = useCallback(
    (next: string[]) => {
      idsRef.current = next;
      setIds(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* приватный режим */
      }
    },
    [key],
  );
  const push = useCallback(() => {
    void webFavoritesSyncFn({ data: { slug, ids: idsRef.current, mode: "replace" } }).catch(() => {
      /* список остаётся в браузере; уйдёт со следующим сердечком */
    });
  }, [slug]);
  useEffect(() => {
    let local: string[] = [];
    try {
      local = parseFavorites(localStorage.getItem(key));
    } catch {
      /* пусто */
    }
    idsRef.current = local;
    setIds(local);
    setReady(true);
    merging.current = true;
    touched.current = false;
    let live = true;
    webFavoritesSyncFn({ data: { slug, ids: local, mode: "merge" } })
      .then((saved) => {
        if (!live) return;
        merging.current = false;
        if (touched.current) push();
        else if (saved) store(saved);
      })
      .catch(() => {
        merging.current = false;
      });
    return () => {
      live = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [key, slug, store, push]);
  const persist = useCallback(
    (next: string[]) => {
      touched.current = true;
      store(next);
      if (merging.current) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(push, 800);
    },
    [store, push],
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
