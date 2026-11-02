import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { saveV4SellerSettingsFn, v4SellerSettingsFn } from "@/app/admin/v4-seller.functions";
import { Card, Empty, ErrorBox, PageTitle, useAction } from "@/app/ui";
import { roleAllows } from "@/core/auth/roles";
import { panelT, type PanelKey } from "@/v4/screens/panel-texts";
import type { SellerSettings } from "@/v4/seller/settings";

/**
 * «ИИ-продавец (v4)»: анкета продавца, из которой консультант v4 берёт
 * условия, и стоп-слова для комментариев. Лимит ИИ — только показ.
 */
export const Route = createFileRoute("/admin/_authed/v4-seller")({
  loader: () => v4SellerSettingsFn(),
  component: V4SellerPage,
});

const FIELDS: Array<{ key: keyof SellerSettings["profile"]; label: PanelKey; rows: number }> = [
  { key: "shop_name", label: "fShopName", rows: 1 },
  { key: "about", label: "fAbout", rows: 4 },
  { key: "payment_terms", label: "fPayment", rows: 3 },
  { key: "delivery_terms", label: "fDelivery", rows: 3 },
  { key: "tone", label: "fTone", rows: 2 },
];

function V4SellerPage() {
  const view = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = panelT(shop.locale);
  return (
    <>
      <PageTitle title={t("sellerTitle")} subtitle={t("sellerSubtitle")} />
      {view.state === "not_connected" ? (
        <Empty>{t("notConnected")}</Empty>
      ) : view.state === "no_shop" ? (
        <Empty>{t("noShop")}</Empty>
      ) : (
        <SellerForm settings={view.settings} />
      )}
    </>
  );
}

function SellerForm({ settings }: { settings: SellerSettings }) {
  const { shop } = Route.useRouteContext();
  const t = panelT(shop.locale);
  const router = useRouter();
  const canWrite = roleAllows(shop.role, "admin");
  const [profile, setProfile] = useState<Record<string, string>>({ ...settings.profile });
  const [spam, setSpam] = useState(settings.spamWords.join("\n"));
  const [note, setNote] = useState<string | null>(null);
  const save = useAction(async () => {
    const r = await saveV4SellerSettingsFn({
      data: { profile, spamWords: spam.split("\n"), version: settings.version },
    });
    setNote(r.ok ? t("saved") : t("stale"));
    if (r.ok) await router.invalidate();
  });
  return (
    <Card>
      <div className="space-y-4">
        {FIELDS.map((f) => (
          <label key={f.key} className="block text-sm">
            <span className="mb-1 block font-medium">{t(f.label)}</span>
            <textarea
              className="input w-full"
              rows={f.rows}
              maxLength={2000}
              disabled={!canWrite}
              value={profile[f.key] ?? ""}
              onChange={(e) => setProfile({ ...profile, [f.key]: e.target.value })}
            />
          </label>
        ))}
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("fSpam")}</span>
          <textarea
            className="input w-full"
            rows={4}
            disabled={!canWrite}
            value={spam}
            onChange={(e) => setSpam(e.target.value)}
          />
        </label>
        <div className="text-sm text-muted">
          {t("aiLimit")}: ${(settings.roomMicroUsd / 1_000_000).toFixed(2)} / $
          {(settings.limitMicroUsd / 1_000_000).toFixed(2)}
        </div>
        {canWrite ? (
          <button
            type="button"
            className="btn-primary"
            disabled={save.busy}
            onClick={() => void save.run().catch(() => {})}
          >
            {t("save")}
          </button>
        ) : null}
        {note ? <div className="text-sm">{note}</div> : null}
        <ErrorBox error={save.error} />
      </div>
    </Card>
  );
}
