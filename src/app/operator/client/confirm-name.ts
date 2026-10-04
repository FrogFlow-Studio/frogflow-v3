/** Подтверждение опасного действия вводом названия клиента: сравнение без учёта регистра и лишних пробелов. */
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export function nameMatches(typed: string, name: string): boolean {
  const n = norm(name);
  return n !== "" && norm(typed) === n;
}

/** Вкладки карточки клиента; ключ идёт в адрес (`?tab=`). */
export const CLIENT_TABS = [
  { key: "overview", title: "Обзор" },
  { key: "channels", title: "Каналы" },
  { key: "billing", title: "Оплата" },
  { key: "log", title: "Журнал" },
  { key: "migration", title: "Переезд" },
] as const;

export type ClientTab = (typeof CLIENT_TABS)[number]["key"];

export function parseTab(v: unknown): ClientTab {
  return CLIENT_TABS.find((t) => t.key === v)?.key ?? "overview";
}
