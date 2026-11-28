import { useEffect, useRef, useSyncExternalStore } from "react";
import type { TgWebApp } from "./cart";

/**
 * Главная кнопка Telegram. Страница регистрирует действие, каркас магазина
 * рисует кнопку. Вне Mini App реестр пуст и ничего не вызывается.
 */

type Action = { text: string; run: () => void };

let action: Action | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function useTelegramMainAction(active: boolean, text: string, run: () => void): void {
  const ref = useRef(run);
  ref.current = run;
  useEffect(() => {
    if (!active || !text) return;
    const mine: Action = { text, run: () => ref.current() };
    action = mine;
    emit();
    return () => {
      if (action === mine) action = null;
      emit();
    };
  }, [active, text]);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useTelegramMainActive(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => action !== null,
    () => false,
  );
}

export function TelegramMainButton({ wa }: { wa: TgWebApp | null }) {
  const current = useSyncExternalStore(
    subscribe,
    () => action,
    () => null,
  );
  const button = wa?.MainButton;
  const run = current?.run;

  useEffect(() => {
    if (!button) return;
    if (!current) {
      button.hide();
      return;
    }
    button.setText(current.text);
    button.show();
    return () => button.hide();
  }, [button, current]);

  useEffect(() => {
    if (!button || !run) return;
    button.onClick(run);
    return () => button.offClick(run);
  }, [button, run]);

  return null;
}
