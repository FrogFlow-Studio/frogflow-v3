/**
 * «+ Создать» и действия в Ctrl K (Ж5): что можно начать с любой страницы. Чистая
 * функция: берёт готовое меню (модули) и роль, лишнего не добавляет. Меняют только
 * те, кто может править (`canEdit`); бухгалтеру и «только просмотр» — ничего.
 */
import type { AdminKey } from "@/app/i18n/admin";
import { canEdit, roleAllows, type AdminRole } from "@/core/auth/roles";
import type { AdminNav } from "./nav-model";

export type CreateKey = "order" | "product" | "broadcast" | "promo" | "reply";

export type CreateAction = {
  key: CreateKey;
  label: AdminKey;
  to: string;
  params?: Record<string, string>;
};

const PHYSICAL = new Set(["confectionery", "flowers"]);

export function createActions(
  nav: AdminNav,
  shop: { role: string; vertical: string },
): CreateAction[] {
  const role = shop.role as AdminRole;
  if (!canEdit(role)) return [];
  const inMenu = (to: string) => nav.groups.some((g) => g.items.some((i) => i.to === to));
  const out: CreateAction[] = [];
  if (PHYSICAL.has(shop.vertical) && inMenu("/admin/orders"))
    out.push({ key: "order", label: "create.order", to: "/admin/orders/new" });
  if (inMenu("/admin/products"))
    out.push({
      key: "product",
      label: "create.product",
      to: "/admin/products/$id",
      params: { id: "new" },
    });
  if (inMenu("/admin/broadcasts"))
    out.push({ key: "broadcast", label: "create.broadcast", to: "/admin/broadcasts" });
  // Акции создаёт владелец или администратор: менеджеру в меню «Скидки» есть, но «Создать» её не предлагает.
  if (roleAllows(role, "admin") && inMenu("/admin/discounts"))
    out.push({ key: "promo", label: "create.promo", to: "/admin/discounts" });
  if (inMenu("/admin/chat")) out.push({ key: "reply", label: "create.reply", to: "/admin/chat" });
  return out;
}
