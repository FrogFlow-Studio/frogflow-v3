import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { newsFn, newsReadFn } from "@/app/admin/news.functions";
import { adminT, intlLocale } from "@/app/i18n/admin";
import { Badge, Card, Empty, PageTitle } from "@/app/ui";

export const Route = createFileRoute("/admin/_authed/news")({
  loader: () => newsFn(),
  component: NewsPage,
});

/** «Что нового»: новости платформы. Открыли страницу — прочитано, бейдж в меню гаснет. */
function NewsPage() {
  const view = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const router = useRouter();
  // Какие были новыми при открытии: подсветка остаётся, пока страница открыта.
  const [fresh] = useState(() =>
    view.available
      ? new Set(view.items.filter((i) => !i.read).map((i) => i.id))
      : new Set<string>(),
  );
  const unread = view.available ? view.unread : 0;
  useEffect(() => {
    if (unread > 0)
      void newsReadFn().then(
        () => router.invalidate(),
        () => {},
      );
    // Один раз на открытие: повторный вызов после invalidate видит unread = 0.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!view.available)
    return (
      <>
        <PageTitle title={t("news.title")} subtitle={t("news.subtitle")} />
        <Card>
          <Empty>
            <p className="font-medium">{t("news.soon.title")}</p>
            <p className="mt-1">{t("news.soon.text")}</p>
          </Empty>
        </Card>
      </>
    );
  return (
    <>
      <PageTitle title={t("news.title")} subtitle={t("news.subtitle")} />
      {view.items.length === 0 ? (
        <Card>
          <Empty>{t("news.empty")}</Empty>
        </Card>
      ) : (
        <div className="space-y-3">
          {view.items.map((n) => (
            <Card key={n.id}>
              <article className="space-y-2 p-4">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold">{n.title}</h2>
                  {fresh.has(n.id) && <Badge tone="accent">{t("news.new")}</Badge>}
                </div>
                <p className="text-xs text-muted">
                  {new Date(n.publishedAt).toLocaleDateString(intlLocale(shop.locale), {
                    dateStyle: "long",
                  })}
                </p>
                <p className="whitespace-pre-wrap text-sm">{n.body}</p>
              </article>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
