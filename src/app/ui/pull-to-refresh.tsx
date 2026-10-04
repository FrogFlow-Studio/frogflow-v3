import { useEffect, useRef, useState } from "react";

/** Сколько пикселей надо потянуть вниз, чтобы отпускание обновило страницу. */
export const PULL_THRESHOLD = 70;

/**
 * Жест «потянуть — обновить»: считается только когда страница уже прокручена
 * к самому верху и палец ведёт вниз. Чистая функция — чтобы проверить порог в тесте.
 */
export function pullState(
  startY: number,
  curY: number,
  scrollTop: number,
): "idle" | "pull" | "ready" {
  if (scrollTop > 0) return "idle";
  const dy = curY - startY;
  if (dy <= 10) return "idle";
  return dy >= PULL_THRESHOLD ? "ready" : "pull";
}

/** Подписка на жест у окна; `onRefresh` вызывается один раз на отпускание. Мышь и клавиатура не затронуты. */
export function usePullToRefresh(onRefresh: () => Promise<unknown> | void) {
  const [state, setState] = useState<"idle" | "pull" | "ready" | "busy">("idle");
  const start = useRef<number | null>(null);
  const busy = useRef(false);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  useEffect(() => {
    const top = () => window.scrollY || document.documentElement.scrollTop || 0;
    const onStart = (e: TouchEvent) => {
      start.current = top() === 0 ? (e.touches[0]?.clientY ?? null) : null;
    };
    const onMove = (e: TouchEvent) => {
      if (start.current === null || busy.current) return;
      const s = pullState(start.current, e.touches[0]?.clientY ?? start.current, top());
      setState(s);
    };
    const onEnd = async () => {
      const was = start.current !== null;
      start.current = null;
      setState((cur) => {
        if (was && cur === "ready" && !busy.current) {
          busy.current = true;
          void Promise.resolve(refresh.current()).finally(() => {
            busy.current = false;
            setState("idle");
          });
          return "busy";
        }
        return busy.current ? "busy" : "idle";
      });
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);
  return state;
}
