import { createContext, useContext, type ReactNode } from "react";
import { settingsEntry } from "./registry";

/** Какие разделы страницы настроек показаны (тема и поиск) и какие менялись недавно. */
export type SettingsFilter = { shown: ReadonlySet<string>; recent: ReadonlySet<string> };
const Ctx = createContext<SettingsFilter | null>(null);
export const SettingsFilterProvider = Ctx.Provider;

/**
 * Обёртка карточки настроек: якорь `#id`, колонки из реестра, скрытие по теме
 * и поиску (карточка остаётся в странице — введённое в форму не пропадает),
 * недавно изменённые — вперёд. Разделу без записи в реестре здесь не место:
 * `registry.test.ts` ловит его раньше.
 */
export function SettingsSection({ id, children }: { id: string; children: ReactNode }) {
  const f = useContext(Ctx);
  const entry = settingsEntry(id);
  const shown = !f || f.shown.has(id);
  const recent = Boolean(f?.recent.has(id));
  return (
    <div
      id={id}
      data-settings-section={id}
      hidden={!shown}
      className={`scroll-mt-4 ${entry?.wide ? "lg:col-span-2" : ""}`}
      style={recent ? { order: -1 } : undefined}
    >
      {children}
    </div>
  );
}
