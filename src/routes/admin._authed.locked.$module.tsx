import { createFileRoute, Link } from "@tanstack/react-router";
import { adminT } from "@/app/i18n/admin";
import { moduleDescKey, moduleTitleKey } from "@/app/i18n/admin/catalog";
import { Card, PageTitle } from "@/app/ui";
import { groupThousands } from "@/core/money/money";
import { MODULE_KEYS, moduleDef, type ModuleKey } from "@/core/modules/registry";

/**
 * Раздел, модуль которого не подключён: вместо ошибки 500 или молчаливого
 * переброса на «Обзор» — что это за модуль, сколько стоит и куда нажать.
 * `pricelist` — не модуль тарифа: консультанта по прайсу включает оператор.
 */
export const Route = createFileRoute("/admin/_authed/locked/$module")({
  component: LockedPage,
});

const isModule = (k: string): k is ModuleKey => (MODULE_KEYS as readonly string[]).includes(k);

function LockedPage() {
  const { shop } = Route.useRouteContext();
  const { module } = Route.useParams();
  const t = adminT(shop.locale);
  if (!isModule(module)) {
    return (
      <>
        <PageTitle title={t("locked.pricelist.title")} />
        <Card>
          <p className="text-sm">{t("locked.pricelist.text")}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/admin/support" className="btn-primary">
              {t("locked.support")}
            </Link>
            <Link to="/admin" className="btn-ghost">
              {t("locked.back")}
            </Link>
          </div>
        </Card>
      </>
    );
  }
  const d = moduleDef(module);
  const title = t(moduleTitleKey(module));
  return (
    <>
      <PageTitle title={t("locked.title", { module: title })} />
      <Card>
        <p className="text-sm">{t(moduleDescKey(module))}</p>
        <p className="mt-2 text-sm text-muted">{t("locked.text")}</p>
        <p className="mt-2 text-sm font-medium">
          {d.price === null
            ? t("locked.free")
            : t("locked.price", { price: groupThousands(String(d.price)) })}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link to="/admin/modules" className="btn-primary">
            {t("locked.open")}
          </Link>
          <Link to="/admin" className="btn-ghost">
            {t("locked.back")}
          </Link>
        </div>
      </Card>
    </>
  );
}
