import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { captureLaunchParams, pickInitData } from "./tg-init-data";

/** Корзина витрины: в браузере покупателя, по магазину. Сервер её не видит до оформления. */
export type CartLine = {
  productId: string;
  variantId: string | null;
  name: string;
  price: number;
  currency: string;
  image: string | null;
  qty: number;
  kind: "digital" | "physical";
};

type CartApi = {
  lines: CartLine[];
  count: number;
  total: number;
  currency: string;
  add: (line: Omit<CartLine, "qty">, qty?: number) => "ok" | "mixed";
  setQty: (productId: string, variantId: string | null, qty: number) => void;
  clear: () => void;
};

const Ctx = createContext<CartApi | null>(null);

export function CartProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const key = `ff-cart-${slug}`;
  const [lines, setLines] = useState<CartLine[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setLines(JSON.parse(raw) as CartLine[]);
    } catch {
      /* пусто */
    }
  }, [key]);
  const persist = useCallback(
    (next: CartLine[]) => {
      setLines(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* приватный режим */
      }
    },
    [key],
  );
  const api = useMemo<CartApi>(() => {
    const total = lines.reduce((s, l) => s + l.price * l.qty, 0);
    return {
      lines,
      count: lines.reduce((s, l) => s + l.qty, 0),
      total,
      currency: lines[0]?.currency ?? "KZT",
      add: (line, qty = 1) => {
        if (lines.some((l) => l.kind !== line.kind)) return "mixed";
        const i = lines.findIndex(
          (l) => l.productId === line.productId && l.variantId === line.variantId,
        );
        if (i >= 0) {
          const next = lines.slice();
          next[i] = {
            ...next[i]!,
            qty: line.kind === "digital" ? 1 : Math.min(99, next[i]!.qty + qty),
          };
          persist(next);
        } else persist([...lines, { ...line, qty: line.kind === "digital" ? 1 : qty }]);
        return "ok";
      },
      setQty: (productId, variantId, qty) => {
        persist(
          qty <= 0
            ? lines.filter((l) => !(l.productId === productId && l.variantId === variantId))
            : lines.map((l) =>
                l.productId === productId && l.variantId === variantId
                  ? { ...l, qty: Math.min(99, qty) }
                  : l,
              ),
        );
      },
      clear: () => persist([]),
    };
  }, [lines, persist]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useCart(): CartApi {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart вне CartProvider");
  return c;
}

/** Telegram Mini App: объект появляется только внутри Telegram. */
export type TgWebApp = {
  initData: string;
  close: () => void;
  openTelegramLink: (url: string) => void;
  expand?: () => void;
  ready?: () => void;
  colorScheme?: "light" | "dark";
};

export function useTelegramWebApp(): TgWebApp | null {
  const [wa, setWa] = useState<TgWebApp | null>(null);
  useEffect(() => {
    // Параметры запуска — сразу, пока адрес не сменился и SDK мог не успеть.
    const captured = captureLaunchParams(window.location, window.sessionStorage);
    let tries = 0;
    const attach = (): boolean => {
      const w = (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;
      const initData = pickInitData({ sdk: w?.initData, captured });
      if (!initData) return false;
      if (w?.initData) {
        setWa(w);
        w.ready?.();
        w.expand?.();
        if (w.colorScheme === "dark") document.documentElement.classList.add("dark");
        return true;
      }
      // SDK ещё грузится: ждём его, а initData из параметров запуска годится для сервера сразу.
      if (w || tries >= 30) {
        setWa({
          initData,
          close: () => w?.close?.(),
          openTelegramLink: (url) =>
            w?.openTelegramLink ? w.openTelegramLink(url) : window.open(url),
        });
        return true;
      }
      return false;
    };
    if (attach()) return;
    const timer = setInterval(() => {
      tries++;
      if (attach() || tries >= 30) clearInterval(timer);
    }, 100);
    return () => clearInterval(timer);
  }, []);
  return wa;
}
