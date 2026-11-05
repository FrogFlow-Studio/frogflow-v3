import { useRouteContext } from "@tanstack/react-router";
import { adminT } from "@/app/i18n/admin";
import { Badge } from "@/app/ui";

/*
 * Бейдж статуса заказа. Отдельный модуль, а не экспорт из маршрута «Заказы»:
 * экспорт из файла маршрута остаётся в общем коде и тянул словарь админки на
 * каждую страницу сайта, включая главную.
 */
const STATUS_TONE: Record<string, "neutral" | "ok" | "warn" | "danger" | "accent"> = {
  awaiting_payment: "neutral",
  awaiting_confirmation: "warn",
  delivering: "accent",
  delivered: "ok",
  paid: "accent",
  accepted: "accent",
  in_production: "accent",
  ready: "warn",
  rejected: "danger",
  cancelled: "danger",
  refunded: "danger",
};

const STATUS_KEYS = [
  "awaiting_payment",
  "awaiting_confirmation",
  "delivering",
  "delivered",
  "paid",
  "accepted",
  "in_production",
  "ready",
  "rejected",
  "cancelled",
  "refunded",
] as const;

export function OrderStatus({ status }: { status: string }) {
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  const t = adminT(shop.locale);
  const known = (STATUS_KEYS as readonly string[]).includes(status);
  return (
    <Badge tone={STATUS_TONE[status] ?? "neutral"}>
      {known ? t(`orders.status.${status as (typeof STATUS_KEYS)[number]}`) : status}
    </Badge>
  );
}
