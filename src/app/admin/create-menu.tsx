import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { AdminT } from "@/app/i18n/admin";
import type { CreateAction } from "./create-actions";

/** «+ Создать» над меню (Ж5): список действий, что роль и модули позволяют. Нет действий — кнопки нет. */
export function CreateMenu({ actions, t }: { actions: CreateAction[]; t: AdminT }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (actions.length === 0) return null;
  return (
    <div ref={box} className="relative mb-2">
      <button
        type="button"
        className="btn-primary w-full text-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        // Меню на телефоне закрывается любым щелчком внутри: кнопка «Создать» его не закрывает.
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {t("create.button")}
      </button>
      {open && (
        <ul
          role="menu"
          aria-label={t("create.title")}
          className="absolute left-0 right-0 z-40 mt-1 overflow-hidden rounded-md border border-line bg-bg shadow-lg"
        >
          {actions.map((a) => (
            <li key={a.key} role="none">
              <Link
                role="menuitem"
                to={a.to as "/admin/orders/new"}
                params={a.params as never}
                className="block px-3 py-2 text-sm hover:bg-surface-2"
                onClick={() => setOpen(false)}
              >
                {t(a.label)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
