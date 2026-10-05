import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { AdminT } from "@/app/i18n/admin";
import { Badge } from "@/app/ui";
import type { AdminNav, NavItem } from "./nav-model";

type T = AdminT;

function useActive() {
  const loc = useRouterState({ select: (s) => s.location });
  return (item: NavItem) => {
    const path = loc.pathname.replace(/\/+$/, "") || "/";
    if (item.exact) return path === item.to;
    const inside = path === item.to || path.startsWith(`${item.to}/`);
    if (!inside) return false;
    // «Розыгрыши» живут на странице «Рассылок»: подсвечивается ровно один из двух.
    const hash = loc.hash.replace(/^#/, "");
    if (item.hash) return hash === item.hash;
    return !(item.to === "/admin/broadcasts" && hash === "giveaways");
  };
}

function ItemLink({
  item,
  t,
  active,
  onNavigate,
}: {
  item: NavItem;
  t: T;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      to={item.to}
      hash={item.hash}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`block rounded-md px-3 py-2 text-sm hover:bg-surface-2 ${
        active ? "bg-surface-2 font-medium text-fg" : "text-fg/80"
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        {t(item.label)}
        {item.badge && <Badge tone={item.badge.tone}>{item.badge.value}</Badge>}
      </span>
    </Link>
  );
}

/** Закреплённые сверху: самые частые пункты, в группах их нет. */
const PINNED = new Set(["/admin/orders", "/admin/chat"]);

/**
 * Меню: «Обзор» и закреплённые «Заказы»/«Входящие» сверху, ниже группы-аккордеон.
 * Раскрыта одна группа — с текущей страницей, остальные свёрнуты до заголовка.
 */
export function AdminNavLinks({
  nav,
  t,
  onNavigate,
}: {
  nav: AdminNav;
  t: T;
  onNavigate?: () => void;
}) {
  const isActive = useActive();
  const pinned = nav.groups.flatMap((g) => g.items).filter((i) => PINNED.has(i.to));
  const groups = nav.groups
    .map((g) => ({ ...g, items: g.items.filter((i) => !PINNED.has(i.to)) }))
    .filter((g) => g.items.length > 0);
  const activeGroup = groups.find((g) => g.items.some(isActive))?.id ?? null;
  const [open, setOpen] = useState<string | null>(activeGroup);
  // Перешли на другую страницу (в том числе по ссылке извне) — раскрывается её группа.
  useEffect(() => {
    if (activeGroup) setOpen(activeGroup);
  }, [activeGroup]);
  return (
    <div className="space-y-1">
      <ItemLink item={nav.overview} t={t} active={isActive(nav.overview)} onNavigate={onNavigate} />
      {pinned.map((item) => (
        <ItemLink key={item.to} item={item} t={t} active={isActive(item)} onNavigate={onNavigate} />
      ))}
      <div className="my-1 border-t border-line" />
      {groups.map((g) => {
        const expanded = open === g.id;
        // Бейдж свёрнутой группы — сумма чисел внутри, чтобы «красное» было видно, не раскрывая.
        const total = g.items.reduce((n, i) => n + (i.badge?.value ?? 0), 0);
        return (
          <div key={g.id} role="group" aria-label={t(g.label)} className="space-y-0.5">
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setOpen(expanded ? null : g.id)}
              className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted hover:bg-surface-2"
            >
              <span>{t(g.label)}</span>
              <span className="flex items-center gap-2">
                {!expanded && total > 0 && <Badge tone="accent">{total}</Badge>}
                <span aria-hidden className={`text-[10px] ${expanded ? "rotate-90" : ""}`}>
                  ▶
                </span>
              </span>
            </button>
            {expanded &&
              g.items.map((item) => (
                <ItemLink
                  key={`${item.to}#${item.hash ?? ""}`}
                  item={item}
                  t={t}
                  active={isActive(item)}
                  onNavigate={onNavigate}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Нижняя панель телефона: четыре главных раздела и «Ещё» — лист со всем меню.
 * На компьютере не рисуется (там боковое меню).
 */
export function AdminBottomBar({ nav, t }: { nav: AdminNav; t: T }) {
  const [more, setMore] = useState(false);
  const isActive = useActive();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => setMore(false), [pathname]);
  const badge = (item: NavItem) =>
    item.badge && (
      <span className="absolute right-2 top-1">
        <Badge tone={item.badge.tone}>{item.badge.value}</Badge>
      </span>
    );
  const tab = "relative flex flex-1 flex-col items-center justify-center px-1 text-sm";
  return (
    <>
      {more && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setMore(false)}
          aria-hidden
        />
      )}
      {more && (
        <div
          role="dialog"
          aria-label={t("nav.moreTitle")}
          className="fixed inset-x-0 bottom-14 z-40 max-h-[70vh] overflow-y-auto rounded-t-xl border border-line bg-surface p-3 md:hidden"
        >
          <AdminNavLinks nav={nav} t={t} onNavigate={() => setMore(false)} />
        </div>
      )}
      <nav
        aria-label={t("nav.bottomBar")}
        className="fixed inset-x-0 bottom-0 z-40 flex h-14 border-t border-line bg-surface md:hidden"
      >
        {nav.primary.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            aria-current={isActive(item) ? "page" : undefined}
            className={`${tab} ${isActive(item) ? "font-semibold text-fg" : "text-muted"}`}
          >
            {t(item.label)}
            {badge(item)}
          </Link>
        ))}
        <button
          type="button"
          aria-expanded={more}
          onClick={() => setMore((v) => !v)}
          className={`${tab} ${more ? "font-semibold text-fg" : "text-muted"}`}
        >
          {more ? t("nav.close") : t("nav.more")}
        </button>
      </nav>
    </>
  );
}
