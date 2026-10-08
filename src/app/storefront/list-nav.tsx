import { useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type ReactNode, type TouchEvent } from "react";
import { storeCatalogPageFn } from "@/app/storefront/catalog.functions";
import { useStorefrontLocale } from "@/app/storefront/locale";
import type { StoreProduct } from "@/core/storefront/catalog";
import {
  appendPage,
  listPosition,
  listStorageKey,
  parseListContext,
  restorable,
  scrollTarget,
  swipeDirection,
  type ListContext,
  type ListPosition,
  type ListQuery,
} from "@/core/storefront/list-context";

/**
 * Листание без потерь (Т3, Т4): каталог помнит, откуда открыт товар; карточка листает
 * соседей стрелками и свайпом, «Назад» возвращает в список на тот же товар.
 * Логика — в core/storefront/list-context, здесь только браузер.
 */

function readList(slug: string): ListContext | null {
  try {
    return parseListContext(sessionStorage.getItem(listStorageKey(slug)), slug, Date.now());
  } catch {
    return null;
  }
}

function writeList(ctx: ListContext) {
  try {
    sessionStorage.setItem(listStorageKey(ctx.query.slug), JSON.stringify(ctx));
  } catch {
    /* приватный режим или переполнено — листание просто не появится */
  }
}

/** Номер текущей записи истории (роутер хранит его в состоянии записи). */
function useHistoryIndex() {
  const router = useRouter();
  return useCallback(() => {
    const i = (router.history.location.state as { __TSR_index?: unknown }).__TSR_index;
    return typeof i === "number" ? i : 0;
  }, [router]);
}

/**
 * Каталог: при возврате «Назад» восстанавливает догруженные страницы и прокручивает к
 * открытому товару; `remember` вызывается при открытии товара из сетки.
 */
export function useCatalogReturn(opts: {
  pageKey: string;
  query: ListQuery;
  firstOffset: number;
  firstIds: readonly string[];
  ids: readonly string[];
  extra: readonly StoreProduct[];
  hasMore: boolean;
  restore: (extra: StoreProduct[], hasMore: boolean) => void;
}) {
  const { pageKey, query, firstOffset, firstIds, ids, extra, hasMore, restore } = opts;
  const historyIndex = useHistoryIndex();
  const [target, setTarget] = useState<{ ids: string[]; current: string | null } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const firstIdsRef = useRef(firstIds);
  firstIdsRef.current = firstIds;

  useEffect(() => {
    const ctx = restorable(readList(query.slug), pageKey, historyIndex());
    if (!ctx) return;
    const first = new Set(firstIdsRef.current);
    const more = ctx.extra.filter((p) => !first.has(p.id));
    if (more.length > 0) restoreRef.current(more, ctx.hasMore);
    setTarget({ ids: ctx.ids, current: ctx.current });
  }, [pageKey, query.slug, historyIndex]);

  useEffect(() => {
    if (!target) return;
    setTarget(null);
    const id = scrollTarget(target.ids, target.current, new Set(ids));
    if (!id) return;
    document
      .querySelector(`[data-product-card="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: "center" });
    setFlash(id);
    const timer = setTimeout(() => setFlash(null), 1500);
    return () => clearTimeout(timer);
  }, [target, ids]);

  const remember = (current: string) =>
    writeList({
      v: 1,
      key: pageKey,
      at: Date.now(),
      listIndex: historyIndex(),
      ids: [...ids],
      extra: [...extra],
      hasMore,
      current,
      query,
      firstOffset,
    });

  return { remember, flash };
}

export type ListNav = {
  pos: ListPosition | null;
  busy: boolean;
  failed: boolean;
  go: (dir: "next" | "prev") => void;
};

/** Карточка товара: место в списке, из которого её открыли, и переход к соседу. */
export function useListNav(slug: string, productId: string): ListNav {
  const navigate = useNavigate();
  const router = useRouter();
  const historyIndex = useHistoryIndex();
  // Читаем после отрисовки: на сервере sessionStorage нет, разметка должна совпасть.
  const [pos, setPos] = useState<ListPosition | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const ctx = readList(slug);
    const p = listPosition(ctx, productId, historyIndex());
    setPos(p);
    if (!ctx || !p) return;
    // Открыт из списка (в том числе «Недавно смотрели» под ним) — к нему и вернёмся.
    if (ctx.current !== productId) writeList({ ...ctx, current: productId, at: Date.now() });
    // Соседей грузим заранее, чтобы листание было мгновенным.
    for (const id of [p.next, p.prev]) {
      if (id)
        router.preloadRoute({ to: "/s/$slug/p/$id", params: { slug, id } }).catch(() => {
          /* не успели — загрузится при переходе */
        });
    }
  }, [slug, productId, historyIndex, router]);

  const go = (dir: "next" | "prev") => {
    if (busy) return;
    void (async () => {
      let ctx = readList(slug);
      let p = listPosition(ctx, productId, historyIndex());
      if (!ctx || !p) return;
      if (dir === "next" && !p.next && ctx.hasMore) {
        // Дошли до последнего загруженного — догружаем следующую страницу списка.
        setBusy(true);
        setFailed(false);
        try {
          const page = await storeCatalogPageFn({
            data: { ...ctx.query, offset: ctx.firstOffset + ctx.ids.length },
          });
          ctx = appendPage(ctx, page.items, page.hasMore, Date.now());
          writeList(ctx);
          p = listPosition(ctx, productId, historyIndex());
          setPos(p);
        } catch {
          setFailed(true);
          return;
        } finally {
          setBusy(false);
        }
      }
      const to = dir === "next" ? p?.next : p?.prev;
      if (!to) return;
      writeList({ ...ctx, current: to, at: Date.now() });
      // Заменяем адрес: «Назад» после любого числа листаний ведёт сразу в список.
      void navigate({ to: "/s/$slug/p/$id", params: { slug, id: to }, replace: true });
    })();
  };

  // Компьютер: клавиши ←/→, если фокус не в поле ввода.
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    if (!pos) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      if (e.key === "ArrowRight") goRef.current("next");
      else if (e.key === "ArrowLeft") goRef.current("prev");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pos]);

  return { pos, busy, failed, go };
}

/** «‹ 12 из 48 ›» под крошками; без списка (прямая ссылка) не рисуется. */
export function ListNavBar({ nav }: { nav: ListNav }) {
  const { t } = useStorefrontLocale();
  const { pos, busy, failed, go } = nav;
  if (!pos) return null;
  const total = pos.hasMore ? `${pos.total}+` : String(pos.total);
  const canNext = !!pos.next || pos.hasMore;
  return (
    <nav
      className="mt-3 flex items-center justify-center gap-3 text-sm"
      aria-label={t("list.nav")}
      data-testid="list-nav"
    >
      <button
        type="button"
        className="btn-secondary px-3 py-1"
        aria-label={t("list.prev")}
        disabled={!pos.prev}
        onClick={() => go("prev")}
      >
        ‹
      </button>
      <span className="text-muted tabular-nums" aria-live="polite">
        {t("list.position", { n: pos.index + 1, total })}
      </span>
      <button
        type="button"
        className="btn-secondary px-3 py-1"
        aria-label={t("list.next")}
        disabled={!canNext || busy}
        onClick={() => go("next")}
      >
        ›
      </button>
      {failed && (
        <span role="alert" className="text-danger">
          {t("catalog.loadMoreFailed")}
        </span>
      )}
    </nav>
  );
}

/**
 * Область свайпа к соседнему товару — всё, кроме фото: там свайп листает фото товара.
 * Элементы с собственной горизонтальной прокруткой помечаются `data-no-swipe`.
 */
export function SwipeArea({ nav, children }: { nav: ListNav; children: ReactNode }) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const onStart = (e: TouchEvent) => {
    const touch = e.touches[0];
    const el = e.target as HTMLElement;
    start.current =
      touch && e.touches.length === 1 && !el.closest("[data-no-swipe], input, textarea")
        ? { x: touch.clientX, y: touch.clientY }
        : null;
  };
  const onEnd = (e: TouchEvent) => {
    const from = start.current;
    start.current = null;
    const touch = e.changedTouches[0];
    if (!from || !touch || !nav.pos) return;
    const dir = swipeDirection(touch.clientX - from.x, touch.clientY - from.y);
    if (dir) nav.go(dir);
  };
  return (
    <div onTouchStart={onStart} onTouchEnd={onEnd} data-testid="list-swipe">
      {children}
    </div>
  );
}
