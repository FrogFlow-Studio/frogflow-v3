import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { adminSearchFn } from "@/app/admin/admin.functions";
import { adminT } from "@/app/i18n/admin";
import type { Locale } from "@/core/i18n/locale";
import { formatMoney } from "@/core/money/money";

type Results = Awaited<ReturnType<typeof adminSearchFn>>;
type Item = { label: string; hint: string; go: () => void };

/**
 * Поиск по админке: ⌘K / Ctrl+K — заказ по номеру или имени, товар,
 * покупатель; стрелки и Enter, Esc — закрыть. Запрос — с паузой 200 мс.
 */
export function CommandPalette({ locale }: { locale: Locale }) {
  const t = adminT(locale);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Results | null>(null);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 0);
    else {
      setQ("");
      setRes(null);
    }
  }, [open]);
  useEffect(() => {
    if (!q.trim()) return setRes(null);
    let live = true;
    const timer = setTimeout(() => {
      adminSearchFn({ data: { q } })
        .then((r) => live && (setRes(r), setSel(0)))
        .catch(() => live && setRes(null));
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q]);

  const close = () => setOpen(false);
  const items: Item[] = res
    ? [
        ...res.orders.map((o) => ({
          label: `#${o.no} · ${o.name}`,
          hint: formatMoney(o.total, o.currency),
          go: () => void navigate({ to: "/admin/orders/$id", params: { id: String(o.id) } }),
        })),
        ...res.products.map((p) => ({
          label: p.name,
          hint: t("palette.product"),
          go: () => void navigate({ to: "/admin/products/$id", params: { id: p.id } }),
        })),
        ...res.customers.map((c) => ({
          label: c.name,
          hint: [c.platform, c.phone].filter(Boolean).join(" · "),
          go: () => void navigate({ to: "/admin/customers/$key", params: { key: c.key } }),
        })),
      ]
    : [];
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-24"
      onClick={close}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-lg border border-line bg-bg shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={input}
          className="w-full border-b border-line bg-transparent px-4 py-3 outline-none"
          placeholder={t("palette.placeholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(items.length - 1, s + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            } else if (e.key === "Enter" && items[sel]) {
              items[sel]!.go();
              close();
            }
          }}
        />
        <ul className="max-h-80 overflow-y-auto">
          {q.trim() && res && items.length === 0 && (
            <li className="px-4 py-3 text-sm text-muted">{t("palette.empty")}</li>
          )}
          {items.map((it, i) => (
            <li key={i}>
              <button
                className={`flex w-full justify-between gap-3 px-4 py-2 text-left text-sm ${i === sel ? "bg-surface-2" : ""}`}
                onMouseEnter={() => setSel(i)}
                onClick={() => {
                  it.go();
                  close();
                }}
              >
                <span className="truncate">{it.label}</span>
                <span className="shrink-0 text-muted">{it.hint}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-4 py-2 text-xs text-muted">{t("palette.hint")}</p>
      </div>
    </div>
  );
}
