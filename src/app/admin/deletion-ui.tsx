import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { deleteShopFn, restoreShopFn } from "@/app/admin/admin.functions";
import { adminT } from "@/app/i18n/admin";
import type { Locale } from "@/core/i18n/locale";
import { Card, ErrorBox, Field, useAction } from "@/app/ui";

/** «Удалить магазин» в настройках — только владельцу (app/admin/deletion.server). */
export function DeleteShopCard({ locale, shopName }: { locale: Locale; shopName: string }) {
  const t = adminT(locale);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const run = useAction(async () => {
    await deleteShopFn({ data: { confirm: confirmName } });
    setOpen(false);
    await router.invalidate();
  });
  return (
    <Card title={t("deletion.title")} className="lg:col-span-2 border-danger/40">
      <p className="mb-3 text-sm text-muted">{t("deletion.hint")}</p>
      {!open ? (
        <button className="btn-ghost text-danger" onClick={() => setOpen(true)}>
          {t("deletion.start")}
        </button>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run.run().catch(() => {});
          }}
        >
          <Field label={t("deletion.confirmLabel", { name: shopName })}>
            <input
              className="input"
              value={confirmName}
              autoComplete="off"
              onChange={(e) => setConfirmName(e.target.value)}
            />
          </Field>
          <ErrorBox error={run.error} />
          <div className="flex gap-2">
            <button className="btn-primary bg-danger" disabled={run.busy || !confirmName.trim()}>
              {t("deletion.submit")}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}

/** Баннер во всей админке: магазин удалится тогда-то, владелец может восстановить. */
export function DeletionBanner({
  locale,
  deletionAt,
  owner,
}: {
  locale: Locale;
  deletionAt: string;
  owner: boolean;
}) {
  const t = adminT(locale);
  const router = useRouter();
  const restore = useAction(async () => {
    await restoreShopFn();
    await router.invalidate();
  });
  const date = new Date(deletionAt).toLocaleDateString(locale === "ru" ? "ru-RU" : locale);
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm">
      <span>{t("deletion.banner", { date })}</span>
      {owner && (
        <button
          className="btn-primary text-xs"
          disabled={restore.busy}
          onClick={() => void restore.run().catch(() => {})}
        >
          {t("deletion.restore")}
        </button>
      )}
      <ErrorBox error={restore.error} />
    </div>
  );
}
