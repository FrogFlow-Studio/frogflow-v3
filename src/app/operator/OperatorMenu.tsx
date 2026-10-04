import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Badge, NavLink } from "@/app/ui";
import { OPERATOR_BOTTOM_BAR, OPERATOR_MENU, operatorMenuItems } from "./menu";
import type { OperatorMenuItem } from "./menu";

function ItemLabel({ item, pending }: { item: OperatorMenuItem; pending: number }) {
  if (item.badge !== "requests") return <>{item.label}</>;
  return (
    <span className="flex items-center justify-between gap-2">
      {item.label}
      {pending > 0 && <Badge tone="accent">{pending}</Badge>}
    </span>
  );
}

/** Боковое меню: четыре группы с заголовками. */
export function OperatorSideNav({ pending }: { pending: number }) {
  return (
    <>
      {OPERATOR_MENU.map((group) => (
        <div key={group.id} className="pb-2" data-menu-group={group.id}>
          <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
            {group.title}
          </div>
          {group.items.map((item) => (
            <NavLink key={item.to} to={item.to} activeOptions={{ exact: item.exact ?? false }}>
              <ItemLabel item={item} pending={pending} />
            </NavLink>
          ))}
        </div>
      ))}
    </>
  );
}

/** Нижняя панель на телефоне: три главных раздела и «Ещё» со всеми группами. */
export function OperatorBottomBar({ pending }: { pending: number }) {
  const [more, setMore] = useState(false);
  const main = operatorMenuItems().filter((i) => OPERATOR_BOTTOM_BAR.includes(i.to));
  return (
    <div className="md:hidden">
      {more && (
        <div
          className="fixed inset-x-0 bottom-14 z-30 max-h-[70vh] overflow-y-auto border-t border-line bg-surface p-2"
          role="dialog"
          aria-label="Все разделы"
          onClick={() => setMore(false)}
        >
          {OPERATOR_MENU.map((group) => (
            <div key={group.id} className="pb-2">
              <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                {group.title}
              </div>
              {group.items.map((item) => (
                <NavLink key={item.to} to={item.to} activeOptions={{ exact: item.exact ?? false }}>
                  <ItemLabel item={item} pending={pending} />
                </NavLink>
              ))}
            </div>
          ))}
        </div>
      )}
      <nav
        aria-label="Быстрые разделы"
        className="fixed inset-x-0 bottom-0 z-30 grid h-14 grid-cols-4 border-t border-line bg-surface"
      >
        {main.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            activeOptions={{ exact: item.exact ?? false }}
            className="flex items-center justify-center px-1 text-center text-xs text-fg/80"
            activeProps={{ className: "font-semibold text-fg" }}
            onClick={() => setMore(false)}
          >
            <ItemLabel item={item} pending={pending} />
          </Link>
        ))}
        <button
          type="button"
          className="text-xs text-fg/80"
          aria-expanded={more}
          onClick={() => setMore((v) => !v)}
        >
          Ещё
        </button>
      </nav>
    </div>
  );
}
