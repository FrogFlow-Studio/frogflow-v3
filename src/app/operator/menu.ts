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
  id: "clients" | "money" | "channels" | "system";
  title: string;
  items: OperatorMenuItem[];
};

export const OPERATOR_MENU: OperatorMenuGroup[] = [
  {
    id: "clients",
    title: "Клиенты",
    items: [
      { to: "/operator", label: "Клиенты", exact: true },
      { to: "/operator/clients/new", label: "Подключить клиента" },
      { to: "/operator/requests", label: "Заявки на модули", badge: "requests" },
      { to: "/operator/support", label: "Поддержка" },
      { to: "/operator/news", label: "Новости платформы" },
      { to: "/operator/leads", label: "Лиды" },
      { to: "/operator/partners", label: "Партнёры" },
      { to: "/operator/broadcast", label: "Сообщение владельцам" },
      { to: "/operator/bulk", label: "Массовые действия" },
      { to: "/operator/community", label: "Жалобы сообщества" },
      { to: "/operator/migration", label: "Переезд на v2" },
    ],
  },
  {
    id: "money",
    title: "Деньги",
    items: [
      { to: "/operator/revenue", label: "Выручка" },
      { to: "/operator/renewals", label: "Продления" },
    ],
  },
  {
    id: "channels",
    title: "Каналы и вебхуки",
    items: [{ to: "/operator/settings", label: "Настройки и вебхук Zernio" }],
  },
  {
    id: "system",
    title: "Система",
    items: [
      { to: "/operator/log", label: "Журнал действий" },
      { to: "/operator/health", label: "Здоровье платформы" },
      { to: "/operator/crons", label: "Кроны" },
    ],
  },
];

/** Четыре главных пункта нижней панели на телефоне; остальное — под «Ещё». */
export const OPERATOR_BOTTOM_BAR: OperatorMenuItem["to"][] = [
  "/operator",
  "/operator/requests",
  "/operator/revenue",
];

export function operatorMenuItems(): OperatorMenuItem[] {
  return OPERATOR_MENU.flatMap((g) => g.items);
}
