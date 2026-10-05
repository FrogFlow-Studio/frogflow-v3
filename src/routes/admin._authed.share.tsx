import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { shareFn } from "@/app/admin/share.functions";
import { CopyRow, Qr } from "@/app/admin/share-ui";
import { adminT, type AdminKey } from "@/app/i18n/admin";
import { Card, Field, PageTitle } from "@/app/ui";
import { SOURCE_TAG_MAX, sourceTag } from "@/core/analytics/source-links";
import { SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";
import { SHARE_CHANNELS, mainLink, plainLinks, shareLinks } from "@/core/share/share";

export const Route = createFileRoute("/admin/_authed/share")({
  loader: () => shareFn(),
  component: SharePage,
});

const LANG_NAMES: Record<Locale, string> = {
  ru: "Русский",
  kk: "Қазақша",
  en: "English",
  uz: "Oʻzbekcha",
};

/** «Поделиться» (Р5): ссылки, QR, готовые тексты и отдельные ссылки с меткой по каналам. */
function SharePage() {
  const d = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const [lang, setLang] = useState<Locale>(shop.locale);
  const [custom, setCustom] = useState("");
  const tt = adminT(lang);
  const targets = { bot: d.bot, store: d.store };
  const plain = plainLinks(targets);
  const customTag = sourceTag(custom);
  const customLinks = customTag.ok ? shareLinks(targets, customTag.tag) : null;
  const customError =
    !customTag.ok && customTag.reason !== "empty"
      ? t(`analytics.links.err.${customTag.reason}`)
      : null;
  const channelName = (c: string) => t(`share.channel.${c}` as AdminKey);
  const text = (kind: "instagram" | "whatsapp") => {
    const links = shareLinks(targets, kind);
    const link = links ? mainLink(links) : null;
    return link ? tt(`share.text.${kind}` as AdminKey, { shop: d.shopName, link }) : "";
  };

  if (!d.bot && !d.store)
    return (
      <>
        <PageTitle title={t("share.title")} />
        <Card>
          <p className="text-sm text-muted">{t("share.nothing")}</p>
          <Link to="/admin/settings" className="btn-secondary mt-3 inline-block">
            {t("share.toSettings")}
          </Link>
        </Card>
      </>
    );

  return (
    <>
      <PageTitle title={t("share.title")} subtitle={t("share.subtitle")} />
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card title={t("share.links")}>
          <div className="space-y-4">
            {plain.store && (
              <div className="space-y-2" data-testid="share-store">
                <CopyRow label={t("share.store")} value={plain.store} t={t} />
                <Qr value={plain.store} label={t("share.qrStore")} />
              </div>
            )}
            {plain.bot && (
              <div className="space-y-2" data-testid="share-bot">
                <CopyRow label={t("share.bot")} value={plain.bot} t={t} />
                <Qr value={plain.bot} label={t("share.qrBot")} />
              </div>
            )}
          </div>
        </Card>
        <Card title={t("share.texts")}>
          <Field label={t("share.textLang")}>
            <select
              name="share-lang"
              className="input w-full max-w-xs"
              value={lang}
              onChange={(e) => setLang(e.target.value as Locale)}
            >
              {SUPPORTED_LOCALES.map((l) => (
                <option key={l} value={l}>
                  {LANG_NAMES[l]}
                </option>
              ))}
            </select>
          </Field>
          <p className="my-2 text-xs text-muted">{t("share.textsHint")}</p>
          <div className="space-y-4">
            <CopyRow label={channelName("instagram")} value={text("instagram")} t={t} multiline />
            <CopyRow label={channelName("whatsapp")} value={text("whatsapp")} t={t} multiline />
          </div>
        </Card>
        <Card title={t("share.byChannel")} className="lg:col-span-2">
          <p className="mb-3 text-sm text-muted">{t("share.byChannelHint")}</p>
          <div className="space-y-4">
            {SHARE_CHANNELS.map((c) => {
              const l = shareLinks(targets, c)!;
              return (
                <div key={c} className="space-y-2 rounded-md border border-line p-3">
                  <div className="text-sm font-medium">{channelName(c)}</div>
                  {l.store && <CopyRow label={t("share.store")} value={l.store} t={t} />}
                  {l.bot && <CopyRow label={t("share.bot")} value={l.bot} t={t} />}
                </div>
              );
            })}
            <div className="space-y-2 rounded-md border border-line p-3">
              <Field label={t("share.custom")}>
                <input
                  className="input w-full max-w-sm"
                  name="share-tag"
                  maxLength={SOURCE_TAG_MAX * 2}
                  placeholder={t("analytics.links.placeholder")}
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                />
              </Field>
              {customError && <p className="text-sm text-danger">{customError}</p>}
              {customLinks?.store && (
                <CopyRow label={t("share.store")} value={customLinks.store} t={t} />
              )}
              {customLinks?.bot && <CopyRow label={t("share.bot")} value={customLinks.bot} t={t} />}
            </div>
          </div>
          <p className="mt-3 text-sm text-muted">
            {t("share.results")}{" "}
            <Link to="/admin/analytics" className="underline">
              {t("nav.analytics")}
            </Link>
          </p>
        </Card>
      </div>
    </>
  );
}
