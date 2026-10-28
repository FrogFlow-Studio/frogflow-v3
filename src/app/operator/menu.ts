/**
 * Меню оператора: группы и пункты одним списком. Маршрутный файл
 * `operator._authed.tsx` только рисует его; новый раздел оператора добавляет
 * строку сюда, а не правит разметку.
 */
import type { LinkProps } from "@tanstack/react-router";

export type OperatorMenuItem = {
  to: NonNullable<LinkProps["to"]>;
  label: string;
  /** true — активен только на точном совпадении пути (главная «Клиенты»). */
  exact?: boolean;
  /** Сюда ставится число заявок на модули. */
  badge?: "requests";
};

export type OperatorMenuGroup = {
  id: "work" | "clients" | "growth" | "platform" | "content";
  title: string;
  items: OperatorMenuItem[];
};

export const OPERATOR_MENU: OperatorMenuGroup[] = [
  {
    id: "work",
    title: "Работа",
    items: [
      { to: "/operator", label: "Обзор", exact: true },
      { to: "/operator/support", label: "Поддержка" },
      { to: "/operator/requests", label: "Заявки на модули", badge: "requests" },
      { to: "/operator/community", label: "Жалобы сообщества" },
      { to: "/operator/market-reports", label: "Жалобы на магазины" },
    ],
  },
  {
    id: "clients",
    title: "Клиенты",
    items: [
      { to: "/operator/clients", label: "Все клиенты", exact: true },
      { to: "/operator/clients/new", label: "Подключить клиента" },
      { to: "/operator/bulk", label: "Массовые действия" },
      { to: "/operator/migration", label: "Переезд на v2" },
    ],
  },
  {
    id: "growth",
    title: "Продажи и деньги",
    items: [
      { to: "/operator/leads", label: "Лиды" },
      { to: "/operator/revenue", label: "Выручка" },
      { to: "/operator/renewals", label: "Продления" },
      { to: "/operator/partners", label: "Партнёры" },
    ],
  },
  {
    id: "content",
    title: "Контент",
    items: [
      { to: "/operator/news", label: "Новости платформы" },
      { to: "/operator/broadcast", label: "Сообщение владельцам" },
      { to: "/operator/market-collections", label: "Подборки площадки" },
      { to: "/operator/market-stats", label: "Аналитика площадки" },
    ],
  },
  {
    id: "platform",
    title: "Платформа",
    items: [
      { to: "/operator/health", label: "Здоровье платформы" },
      { to: "/operator/crons", label: "Кроны" },
      { to: "/operator/observer", label: "Наблюдатель" },
      { to: "/operator/log", label: "Журнал действий" },
      { to: "/operator/settings", label: "Настройки и вебхук Zernio" },
    ],
  },
];

/** Четыре главных пункта нижней панели на телефоне; остальное — под «Ещё». */
export const OPERATOR_BOTTOM_BAR: OperatorMenuItem["to"][] = [
  "/operator",
  "/operator/clients",
  "/operator/support",
];

export function operatorMenuItems(): OperatorMenuItem[] {
  return OPERATOR_MENU.flatMap((g) => g.items);
}
