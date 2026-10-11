import { createContext, useContext, type ReactNode } from "react";
import { HelpTip } from "@/app/admin/help-panel";
import { settingsEntry, settingsHelp } from "./registry";

/** Какие разделы страницы настроек показаны (тема и поиск) и какие менялись недавно. */
export type SettingsFilter = { shown: ReadonlySet<string>; recent: ReadonlySet<string> };
const Ctx = createContext<SettingsFilter | null>(null);
export const SettingsFilterProvider = Ctx.Provider;

/**
 * Обёртка карточки настроек: якорь `#id`, колонки из реестра, скрытие по теме
 * и поиску (карточка остаётся в странице — введённое в форму не пропадает),
 * недавно изменённые — вперёд. Разделу без записи в реестре здесь не место:
 * `registry.test.ts` ловит его раньше. В углу — «?»: статья «Помощи» про
 * тему раздела, открытая на нём (`settingsHelp`).
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
      className={`relative min-w-0 scroll-mt-4 ${entry?.wide ? "lg:col-span-2" : ""}`}
      style={recent ? { order: -1 } : undefined}
    >
      {children}
      {entry && !entry.to && (
        <span className="absolute -top-2 -right-2 rounded-full bg-surface">
          <HelpTip {...settingsHelp(entry)} />
        </span>
      )}
    </div>
  );
}
