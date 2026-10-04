import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, ErrorBox, Field, useAction } from "@/app/ui";
import { communityProfileFn, saveCommunityProfileFn } from "@/app/admin/community.functions";
import { adminT } from "@/app/i18n/admin";
import { CommunityRecommend } from "./community-recommend";
import { settingsRoute } from "./route";

type View = Awaited<ReturnType<typeof communityProfileFn>>;

/**
 * Сообщество авторов: профиль и согласие «Показывать меня в сообществе».
 * По умолчанию выключено. Профиль меняет владелец, остальные видят.
 */
export function CommunityCard() {
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const [view, setView] = useState<View | null>(null);
  const [on, setOn] = useState(false);
  const [name, setName] = useState("");
  const [niche, setNiche] = useState("");
  const [city, setCity] = useState("");
  const [about, setAbout] = useState("");
  const [links, setLinks] = useState("");
  const [saved, setSaved] = useState(false);
  const fill = (v: View) => {
    setView(v);
    setOn(v.profile.enabled);
    setName(v.profile.name);
    setNiche(v.profile.niche);
    setCity(v.profile.city);
    setAbout(v.profile.about);
    setLinks(v.profile.links.join("\n"));
  };
  useEffect(() => {
    void communityProfileFn().then(fill);
  }, []);
  const owner = shop.role === "owner";
  const save = useAction(async () => {
    fill(
      await saveCommunityProfileFn({
        data: {
          enabled: on,
          name,
          niche,
          city,
          about,
          links: links
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean),
        },
      }),
    );
    setSaved(true);
  });
  const locked = !owner || view === null;
  return (
    <Card title={t("settings.community.title")}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          void save.run().catch(() => {});
        }}
      >
        <p className="text-sm text-muted">{t("settings.community.intro")}</p>
        {view && (
          <p className="text-sm">
            {t(`settings.community.state.${view.state}`)}
            {view.mod?.reason
              ? ` ${t("settings.community.reason", { reason: view.mod.reason })}`
              : ""}
          </p>
        )}
        {view && (view.state === "visible" || view.state === "hidden") && (
          <p className="text-sm">
            <Link to="/admin/community">{t("settings.community.open")}</Link>
          </p>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={on}
            disabled={locked}
            onChange={(e) => setOn(e.target.checked)}
          />
          {t("settings.community.on")}
        </label>
        <Field label={t("settings.community.name")}>
          <input
            className="input"
            maxLength={80}
            value={name}
            disabled={locked}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label={t("settings.community.niche")}>
          <input
            className="input"
            maxLength={80}
            value={niche}
            disabled={locked}
            onChange={(e) => setNiche(e.target.value)}
          />
        </Field>
        <Field label={t("settings.community.city")}>
          <input
            className="input"
            maxLength={60}
            value={city}
            disabled={locked}
            onChange={(e) => setCity(e.target.value)}
          />
        </Field>
        <Field label={t("settings.community.about")}>
          <textarea
            className="input min-h-24"
            maxLength={600}
            value={about}
            disabled={locked}
            onChange={(e) => setAbout(e.target.value)}
          />
        </Field>
        <Field label={t("settings.community.links")}>
          <textarea
            className="input min-h-20"
            value={links}
            disabled={locked}
            onChange={(e) => setLinks(e.target.value)}
          />
        </Field>
        {owner ? (
          <div className="flex items-center gap-3">
            <button className="btn-primary" disabled={save.busy || view === null}>
              {t("common.save")}
            </button>
            {saved && <span className="text-sm text-ok">{t("settings.saved")}</span>}
          </div>
        ) : (
          <p className="text-xs text-muted">{t("settings.community.ownerOnly")}</p>
        )}
        <ErrorBox error={save.error} />
      </form>
      {view && (view.state === "visible" || view.state === "hidden") && (
        <CommunityRecommend slug={view.slug} />
      )}
    </Card>
  );
}
