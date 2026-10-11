import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { newsFn, newsReadFn, voteNewsFn } from "@/app/admin/news.functions";
import { adminT, intlLocale } from "@/app/i18n/admin";
import { Badge, Card, Empty, ErrorBox, PageTitle, useAction } from "@/app/ui";
import { canEdit } from "@/core/auth/roles";
import { HelpTip } from "@/app/admin/help-panel";

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

  const vote = useAction(async (newsId: string, option: number) => {
    await voteNewsFn({ data: { newsId, option } });
    await router.invalidate();
  });

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
                {n.poll && (
                  <div className="space-y-2 rounded-md border border-line p-3">
                    <p className="text-sm font-medium">
                      {t("news.poll.title")} <HelpTip article="news" anchor="poll" />
                    </p>
                    {n.poll.myVote !== null ? (
                      <p className="text-sm">
                        {t("news.poll.voted", { option: n.poll.options[n.poll.myVote] ?? "" })}
                      </p>
                    ) : canEdit(shop.role) ? (
                      <>
                        <div className="flex flex-wrap gap-2">
                          {n.poll.options.map((o, i) => (
                            <button
                              key={i}
                              type="button"
                              className="btn-secondary text-sm"
                              disabled={vote.busy}
                              onClick={() => void vote.run(n.id, i).catch(() => {})}
                            >
                              {o}
                            </button>
                          ))}
                        </div>
                        <p className="text-xs text-muted">{t("news.poll.once")}</p>
                        <ErrorBox error={vote.error} />
                      </>
                    ) : (
                      <>
                        <ul className="list-disc pl-5 text-sm">
                          {n.poll.options.map((o, i) => (
                            <li key={i}>{o}</li>
                          ))}
                        </ul>
                        <p className="text-xs text-muted">{t("news.poll.viewOnly")}</p>
                      </>
                    )}
                  </div>
                )}
                {n.action && (n.action.kind === "link" || shop.role === "owner") && (
                  <a className="btn-secondary inline-block text-sm" href={n.action.href}>
                    {t(n.action.kind === "module" ? "news.action.enable" : "news.action.more")}
                  </a>
                )}
              </article>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
