import { useEffect, useRef, useSyncExternalStore } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { telegramBack } from "@/core/storefront/back-nav";
import type { TgWebApp } from "./cart";

/**
 * Кнопка «Назад» Telegram (Т2): только внутри Mini App, вне Telegram ничего
 * не рисует и не меняет. Что показывать и что делать — `core/storefront/back-nav`.
 * Android-кнопка «Назад» при включённой BackButton приходит в тот же обработчик.
 */

/** Открытые поверх страницы окна (просмотр фото): «Назад» сначала закрывает их. */
const overlays: Array<{ close: () => void }> = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Окно поверх страницы, пока `open`: «Назад» Telegram закрывает его, а не страницу. */
export function useBackOverlay(open: boolean, close: () => void): void {
  const ref = useRef(close);
  ref.current = close;
  useEffect(() => {
    if (!open) return;
    const entry = { close: () => ref.current() };
    overlays.push(entry);
    emit();
    return () => {
      const i = overlays.indexOf(entry);
      if (i >= 0) overlays.splice(i, 1);
      emit();
    };
  }, [open]);
}

export function TelegramBackButton({ wa, slug }: { wa: TgWebApp | null; slug: string }) {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const overlayOpen = useSyncExternalStore(
    subscribe,
    () => overlays.length > 0,
    () => false,
  );
  const bb = wa?.BackButton;
  const { visible } = telegramBack({ pathname, slug, overlayOpen, canGoBack: false });

  useEffect(() => {
    if (!bb) return;
    if (visible) bb.show();
    else bb.hide();
  }, [bb, visible]);

  useEffect(() => {
    if (!bb) return;
    const onClick = () => {
      // Решение — в момент нажатия: история и окна могли измениться после отрисовки.
      const { action } = telegramBack({
        pathname: router.state.location.pathname,
        slug,
        overlayOpen: overlays.length > 0,
        canGoBack: router.history.canGoBack(),
      });
      if (action === "close-overlay") overlays[overlays.length - 1]?.close();
      else if (action === "history") router.history.back();
      else if (action === "catalog") void router.navigate({ to: "/s/$slug", params: { slug } });
    };
    bb.onClick(onClick);
    return () => {
      bb.offClick(onClick);
      bb.hide();
    };
  }, [bb, router, slug]);

  return null;
}
