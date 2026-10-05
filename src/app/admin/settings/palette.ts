/**
 * Настройки в быстром поиске (Ctrl K): каждый раздел, доступный роли и
 * модулям, ведёт на страницу настроек с якорем `#id` — страница сама
 * открывает тему этого раздела. Раздел с отдельной страницы ведёт туда.
 */
import type { AdminKey } from "@/app/i18n/admin";
import { entryMatches, entryVisible, SETTINGS_REGISTRY } from "./registry";

export const SETTINGS_SHOWN = 5;

export type SettingsHit = { label: string; theme: string; to: string; hash?: string };

export function searchSettings(
  shop: { role: string; modules: Partial<Record<string, boolean>> },
  q: string,
  t: (k: AdminKey, vars?: Record<string, string>) => string,
): SettingsHit[] {
  if (!q.trim()) return [];
  return SETTINGS_REGISTRY.filter((e) => entryVisible(e, shop) && entryMatches(e, q, t))
    .slice(0, SETTINGS_SHOWN)
    .map((e) => ({
      label: t(e.title, e.titleVars),
      theme: t(`settings19.theme.${e.theme}` as AdminKey),
      to: e.to ?? "/admin/settings",
      hash: e.to ? undefined : e.id,
    }));
}
