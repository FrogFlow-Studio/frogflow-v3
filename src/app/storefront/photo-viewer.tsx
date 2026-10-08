import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { pinchZoom, stepIndex, swipeAction, toggleZoom, ZOOM_MIN } from "@/core/storefront/viewer";
import { useStorefrontLocale } from "./locale";
import { useBackOverlay } from "./telegram-back";

/**
 * Просмотр фото товара на весь экран внутри страницы (Т6): фото целиком на
 * тёмном фоне, листание свайпом и стрелками, счётчик, увеличение двумя пальцами
 * и двойным тапом, закрытие крестиком, Esc, свайпом вниз и кнопкой «Назад»
 * Telegram. Без внешних библиотек; логика жестов — `core/storefront/viewer`.
 */
export function PhotoViewer({
  images,
  index,
  alt,
  onClose,
}: {
  images: string[];
  /** Открытое фото; `null` — просмотр закрыт. */
  index: number | null;
  alt: string;
  onClose: () => void;
}) {
  const open = index !== null && images.length > 0;
  useBackOverlay(open, onClose);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <ViewerDialog images={images} start={index} alt={alt} onClose={onClose} />,
    document.body,
  );
}

type Point = { x: number; y: number };

function ViewerDialog({
  images,
  start,
  alt,
  onClose,
}: {
  images: string[];
  start: number;
  alt: string;
  onClose: () => void;
}) {
  const { t } = useStorefrontLocale();
  const n = images.length;
  const [cur, setCur] = useState(Math.min(Math.max(0, start), n - 1));
  const [zoom, setZoom] = useState(ZOOM_MIN);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [dragY, setDragY] = useState(0);
  const [touching, setTouching] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{
    start: Point;
    last: Point;
    pinch: { dist: number; zoom: number } | null;
    multi: boolean;
  } | null>(null);
  const lastTap = useRef(0);

  const go = (d: -1 | 1) => setCur((i) => stepIndex(i, d, n));

  // Новое фото — обычный размер.
  useEffect(() => {
    setZoom(ZOOM_MIN);
    setPan({ x: 0, y: 0 });
  }, [cur]);

  // Фокус внутрь просмотра, страница под ним не прокручивается; при закрытии — фокус обратно.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "Tab") {
        // Фокус не уходит со страницы просмотра.
        const items = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [],
        );
        if (items.length === 0) return;
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey
          ? i <= 0
            ? items.length - 1
            : i - 1
          : i < 0 || i === items.length - 1
            ? 0
            : i + 1;
        e.preventDefault();
        items[next]!.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // go и onClose читают свежие значения через setState/пропсы родителя.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, n]);

  const dist = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    // Кнопки «‹ ›» нажимаются как обычно, жестом это не считается.
    if ((e.target as HTMLElement).closest("button")) return;
    setTouching(true);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const p = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 1)
      gesture.current = { start: p, last: p, pinch: null, multi: false };
    else if (gesture.current) {
      gesture.current.multi = true;
      gesture.current.pinch = { dist: dist(), zoom };
    }
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    const p = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (pointers.current.size >= 2 && g.pinch) {
      setZoom(pinchZoom(g.pinch.zoom, g.pinch.dist, dist()));
      return;
    }
    if (zoom > ZOOM_MIN) {
      // Увеличено: палец двигает фото.
      const dx = p.x - g.last.x;
      const dy = p.y - g.last.y;
      setPan((cur) => ({ x: cur.x + dx, y: cur.y + dy }));
    } else if (!g.multi) {
      setDragY(Math.max(0, p.y - g.start.y));
    }
    g.last = p;
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0 || !g) return;
    gesture.current = null;
    setTouching(false);
    setDragY(0);
    if (zoom <= ZOOM_MIN) setPan({ x: 0, y: 0 });
    if (g.multi) return;
    const dx = e.clientX - g.start.x;
    const dy = e.clientY - g.start.y;
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      // Двойной тап — увеличить или вернуть обычный размер.
      const now = Date.now();
      if (now - lastTap.current < 300) {
        lastTap.current = 0;
        const z = toggleZoom(zoom);
        setZoom(z);
        if (z === ZOOM_MIN) setPan({ x: 0, y: 0 });
      } else lastTap.current = now;
      return;
    }
    if (zoom > ZOOM_MIN) return;
    const action = swipeAction(dx, dy);
    if (action === "next") go(1);
    else if (action === "prev") go(-1);
    else if (action === "close") onClose();
  };

  const counter = t("viewer.counter", { n: cur + 1, m: n });
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("viewer.title")}
      data-testid="photo-viewer"
      className="fixed inset-0 z-50 flex flex-col bg-black/95 text-white"
      style={{ opacity: dragY ? Math.max(0.4, 1 - dragY / 400) : 1 }}
    >
      <div className="flex items-center justify-between gap-3 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
        <span className="text-sm tabular-nums" aria-live="polite">
          {n > 1 ? counter : ""}
        </span>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={t("viewer.close")}
          className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-xl hover:bg-white/20"
        >
          ✕
        </button>
      </div>
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden select-none"
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        data-testid="photo-viewer-stage"
      >
        <img
          key={images[cur]}
          src={images[cur]}
          alt={n > 1 ? `${alt} — ${counter}` : alt}
          draggable={false}
          className="max-h-full max-w-full object-contain"
          style={{
            transform: `translate(${pan.x}px, ${pan.y + dragY}px) scale(${zoom})`,
            transition: touching ? "none" : "transform 150ms ease-out",
          }}
        />
        {n > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              disabled={cur === 0}
              aria-label={t("viewer.prev")}
              className="absolute left-2 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-xl hover:bg-white/20 disabled:opacity-30 max-sm:hidden"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              disabled={cur === n - 1}
              aria-label={t("viewer.next")}
              className="absolute right-2 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-xl hover:bg-white/20 disabled:opacity-30 max-sm:hidden"
            >
              ›
            </button>
          </>
        )}
      </div>
      <p className="px-3 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-center text-xs text-white/60">
        {t("viewer.hint")}
      </p>
    </div>
  );
}
