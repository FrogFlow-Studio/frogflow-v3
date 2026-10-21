import { useState } from "react";
import { type AdminT } from "@/app/i18n/admin";
import { uploadFile } from "@/app/admin/upload-client";
import { categoryPaths, type CategoryOption } from "@/app/admin/category-paths";
import { type Locale } from "@/core/i18n/locale";

export type Img = { key: string };

export type Mat = { language: Locale; filePath: string; fileName: string | null };

export type Variant = {
  name: string;
  price: number;
  filePath?: string | null;
  fileName?: string | null;
};

export async function upload(
  kind: "image" | "file",
  file: File,
  t: AdminT,
  onProgress?: (sent: number, total: number) => void,
): Promise<{ key: string; name: string }> {
  const key = await uploadFile(
    kind,
    file,
    t,
    (status) => {
      if (status === 0 && file.size > 200 * 1024 * 1024) {
        return `${t("product.uploadBroken")} (${Math.round(file.size / 1048576)} МБ: сброс соединения или лимит хранилища Supabase)`;
      }
      return status === 0 ? t("product.uploadBroken") : t("product.uploadFailed", { status });
    },
    onProgress,
  );
  return { key, name: file.name };
}

export type Progress = { name: string; sent: number; total: number };

const mb = (n: number) => (n / 1048576).toFixed(1);

/** Ход загрузки: имя, процент и мегабайты — видно, идёт ли файл или встал. */
export function UploadProgress({ p, t }: { p: Progress; t: AdminT }) {
  const pct = p.total > 0 ? Math.min(100, Math.round((p.sent / p.total) * 100)) : 0;
  return (
    <div className="mt-3 space-y-1" role="status" aria-live="polite">
      <div className="flex justify-between gap-2 text-xs text-muted">
        <span className="min-w-0 truncate">{t("product.uploading", { name: p.name })}</span>
        <span className="shrink-0">
          {pct}% · {t("product.uploadedOf", { sent: mb(p.sent), total: mb(p.total) })}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded bg-line">
        <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * Разделы товара: поиск и полный путь. Скрытые поиском галочки остаются в
 * форме (display: none), отмеченное не теряется.
 */
export function CategoryPicker({
  categories,
  selected,
  t,
}: {
  categories: CategoryOption[];
  selected: string[];
  t: AdminT;
}) {
  const [q, setQ] = useState("");
  const paths = categoryPaths(categories);
  const sorted = [...categories].sort((a, b) =>
    (paths.get(a.id) ?? "").localeCompare(paths.get(b.id) ?? ""),
  );
  const needle = q.trim().toLowerCase();
  const shown = (id: string) => !needle || (paths.get(id) ?? "").toLowerCase().includes(needle);
  const visible = sorted.filter((c) => shown(c.id)).length;
  if (categories.length === 0)
    return <span className="text-sm text-muted">{t("product.noCategories")}</span>;
  return (
    <div className="space-y-2">
      {categories.length > 8 && (
        <input
          className="input"
          type="search"
          placeholder={t("product.categorySearch")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      )}
      <div className="grid max-h-72 gap-1 overflow-y-auto sm:grid-cols-2">
        {sorted.map((c) => (
          <label
            key={c.id}
            className={`flex items-center gap-2 text-sm ${shown(c.id) ? "" : "hidden"}`}
          >
            <input
              type="checkbox"
              name="categoryIds"
              value={c.id}
              defaultChecked={selected.includes(c.id)}
            />
            <span>
              {c.parent_id && (
                <span className="text-muted">
                  {(paths.get(c.id) ?? "").split(" › ").slice(0, -1).join(" › ")} ›{" "}
                </span>
              )}
              {c.name}
            </span>
          </label>
        ))}
        {visible === 0 && <span className="text-sm text-muted">{t("product.categoryNone")}</span>}
      </div>
    </div>
  );
}

export type ProductTab = "main" | "price" | "stock" | "photos" | "variants" | "bundle" | "promo";
