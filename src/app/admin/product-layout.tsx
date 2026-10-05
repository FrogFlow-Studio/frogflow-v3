import { useEffect, useState, type ReactNode } from "react";
import type { AdminT } from "@/app/i18n/admin";

export type TocSection = { key: string; label: string };

/** Какой раздел сейчас виден: подсвечивается в оглавлении. */
export function useActiveSection(keys: string[]): string {
  const [active, setActive] = useState(keys[0] ?? "");
  const joined = keys.join("|");
  useEffect(() => {
    const els = joined
      .split("|")
      .map((k) => document.getElementById(`sec-${k}`))
      .filter((e): e is HTMLElement => Boolean(e));
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id.replace(/^sec-/, ""), e.isIntersecting);
        const first = joined.split("|").find((k) => seen.get(k));
        if (first) setActive(first);
      },
      { rootMargin: "0px 0px -60% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [joined]);
  return active;
}

/** Оглавление карточки: колонка слева на широком экране, строка чипов на телефоне. */
export function ProductToc({
  sections,
  active,
  t,
}: {
  sections: TocSection[];
  active: string;
  t: AdminT;
}) {
  return (
    <nav
      aria-label={t("product.toc")}
      className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0 lg:pb-0"
    >
      {sections.map((s) => (
        <a
          key={s.key}
          href={`#sec-${s.key}`}
          aria-current={active === s.key ? "true" : undefined}
          className={`shrink-0 whitespace-nowrap rounded-md border px-3 py-1.5 text-sm lg:border-transparent ${
            active === s.key
              ? "border-accent bg-accent/10 text-accent"
              : "border-line text-muted hover:text-fg"
          }`}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}

/** Заголовок раздела на единой странице; якорь для оглавления. */
export function SectionHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={`sec-${id}`} className="scroll-mt-4 text-base font-semibold">
      {children}
    </h2>
  );
}

/**
 * Закреплённая панель «Сохранить / Отменить»: одна на страницу, всегда видна.
 * «Отменить» сбрасывает форму к сохранённому (после подтверждения).
 */
export function SaveBar({
  dirty,
  busy,
  onCancel,
  t,
}: {
  dirty: boolean;
  busy: boolean;
  onCancel: () => void;
  t: AdminT;
}) {
  return (
    <div
      data-testid="product-savebar"
      className="sticky bottom-0 z-20 -mx-4 mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface px-4 py-3"
    >
      <span className={`text-sm ${dirty ? "text-warn" : "text-muted"}`} role="status">
        {dirty ? t("product.bar.unsaved") : t("product.bar.clean")}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-secondary"
          disabled={!dirty || busy}
          onClick={onCancel}
        >
          {t("product.bar.cancel")}
        </button>
        <button type="submit" className="btn-primary" disabled={busy}>
          {t("common.save")}
        </button>
      </div>
    </div>
  );
}
