import { useEffect, useState } from "react";
import { ErrorBox, useAction } from "@/app/ui";
import { recommendViewFn, saveRecommendFn } from "@/app/admin/community.functions";
import { adminT } from "@/app/i18n/admin";
import { settingsRoute } from "./route";
import { roleAllows } from "@/core/auth/roles";

type View = Awaited<ReturnType<typeof recommendViewFn>>;

/**
 * Взаимные рекомендации (С6): автор отмечает до пяти магазинов. На витрине и на странице автора
 * рекомендация видна, только когда магазин отметил вас в ответ. Убрали отметку — исчезает у обоих.
 */
export function CommunityRecommend({ slug }: { slug: string | null }) {
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const [view, setView] = useState<View | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const fill = (v: View) => {
    setView(v);
    setChosen(v.chosen);
  };
  useEffect(() => {
    void recommendViewFn().then(fill);
  }, []);
  const owner = roleAllows(shop.role, "admin");
  const save = useAction(async () => {
    fill(await saveRecommendFn({ data: { ids: chosen } }));
    setSaved(true);
  });
  const toggle = (id: string) => {
    setSaved(false);
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  };
  if (!view) return null;
  return (
    <div className="mt-4 space-y-3 border-t pt-4" data-testid="community-recommend">
      <h3 className="font-medium">{t("settings.community.rec.title")}</h3>
      <p className="text-sm text-muted">{t("settings.community.rec.intro", { max: view.max })}</p>
      {slug && (
        <p className="text-sm">
          <a href={`/author/${slug}`} target="_blank" rel="noreferrer" className="underline">
            {t("settings.community.rec.page")}
          </a>
        </p>
      )}
      {view.candidates.length === 0 ? (
        <p className="text-sm text-muted">{t("settings.community.rec.none")}</p>
      ) : (
        <ul className="space-y-1">
          {view.candidates.map((c) => (
            <li key={c.id}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={chosen.includes(c.id)}
                  disabled={!owner || (!chosen.includes(c.id) && chosen.length >= view.max)}
                  onChange={() => toggle(c.id)}
                />
                {c.name}
                {view.mutual.includes(c.id) && (
                  <span className="text-xs text-ok">{t("settings.community.rec.mutual")}</span>
                )}
              </label>
            </li>
          ))}
        </ul>
      )}
      {owner && view.candidates.length > 0 && (
        <button
          type="button"
          className="btn-primary"
          disabled={save.busy}
          onClick={() => void save.run().catch(() => {})}
        >
          {t("common.save")}
        </button>
      )}
      {saved && <span className="text-sm text-ok">{t("settings.saved")}</span>}
      <ErrorBox error={save.error} />
    </div>
  );
}
