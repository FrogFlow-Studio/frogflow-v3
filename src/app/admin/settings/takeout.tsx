import { useState } from "react";
import { takeoutLinkFn } from "@/app/admin/admin.functions";
import { Card, ErrorBox, useAction } from "@/app/ui";
import { adminT, intlLocale } from "@/app/i18n/admin";
import { settingsRoute } from "./route";

/** «Забрать мои данные»: ссылка на архив магазина на 24 часа, только владельцу. */
export function TakeoutCard() {
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const make = useAction(async () => {
    setLink(await takeoutLinkFn());
  });
  return (
    <Card title={t("takeout.title")}>
      <p className="mb-3 text-sm text-muted">{t("takeout.hint")}</p>
      <button
        className="btn-secondary text-sm"
        disabled={make.busy}
        onClick={() => void make.run().catch(() => {})}
      >
        {t("takeout.make")}
      </button>
      {link && (
        <div className="mt-3 space-y-2 text-sm">
          <p>
            {t("takeout.ready", {
              date: new Date(link.expiresAt).toLocaleString(intlLocale(shop.locale)),
            })}
          </p>
          <a className="btn-primary inline-block text-sm" href={link.url}>
            {t("takeout.download")}
          </a>
          <p className="text-xs text-muted">{t("takeout.warn")}</p>
        </div>
      )}
      <ErrorBox error={make.error} />
    </Card>
  );
}
