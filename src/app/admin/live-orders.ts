import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { ordersStampFn } from "@/app/admin/admin.functions";
import { shouldRefresh, stampKey } from "@/core/orders/live";

/**
 * Заказы без перезагрузки: пока вкладка видна, раз в `intervalMs` спросить
 * отпечаток заказов и перечитать загрузчики страницы, только если он
 * изменился. Скрытая вкладка не спрашивает; вернулись на неё — сразу сверка.
 */
export function useLiveOrders(intervalMs = 10_000): void {
  const router = useRouter();
  const last = useRef<string | null>(null);
  useEffect(() => {
    let busy = false;
    const tick = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const key = stampKey(await ordersStampFn());
        if (shouldRefresh(last.current, key)) await router.invalidate();
        last.current = key;
      } catch {
        // Сеть или сессия: следующая попытка через интервал, страница не падает.
      } finally {
        busy = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), intervalMs);
    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, intervalMs]);
}
