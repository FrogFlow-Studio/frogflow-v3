import { createFileRoute, useRouter } from "@tanstack/react-router";
import { pricelistFn } from "@/app/admin/pricelist.functions";
import {
  FileCard,
  KnowledgeCard,
  MediaCard,
  PersonaCard,
  RateCard,
  SettingsCard,
  SheetCard,
  TasksCard,
} from "@/app/admin/pricelist-cards";
import { Card, PageTitle } from "@/app/ui";
import { adminT, intlLocale } from "@/app/i18n/admin";
import { consultantWorkspace } from "@/app/admin/nav-model";

export const Route = createFileRoute("/admin/_authed/pricelist")({
  loader: () => pricelistFn(),
  component: PricelistPage,
});

function PricelistPage() {
  const data = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const loc = intlLocale(shop.locale);
  const router = useRouter();
  const canEdit = shop.role !== "viewer" && shop.role !== "accountant";
  const date = (iso: string) =>
    new Date(iso).toLocaleString(loc, { dateStyle: "medium", timeStyle: "short" });

  if (consultantWorkspace(shop))
    // Рабочее место консультанта без продаж: здесь только откуда берутся позиции, цены,
    // курс и фото; задачи, база знаний и образ — на своих страницах меню.
    return (
      <>
        <PageTitle title={t("ws.price.title")} subtitle={t("ws.price.subtitle")} />
        <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <div className="space-y-4">
            <FileCard t={t} data={data} date={date} canEdit={canEdit} onDone={router.invalidate} />
            <SheetCard
              locale={shop.locale}
              t={t}
              data={data}
              date={date}
              canEdit={canEdit}
              onDone={router.invalidate}
            />
          </div>
          <div className="space-y-4">
            <RateCard t={t} data={data} date={date} canEdit={canEdit} onDone={router.invalidate} />
            <MediaCard t={t} data={data} canEdit={canEdit} onDone={router.invalidate} showMatches />
          </div>
        </div>
      </>
    );

  return (
    <>
      <PageTitle title={t("pricelist.title")} subtitle={t("pricelist.subtitle")} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <FileCard t={t} data={data} date={date} canEdit={canEdit} onDone={router.invalidate} />
          <SheetCard
            locale={shop.locale}
            t={t}
            data={data}
            date={date}
            canEdit={canEdit}
            onDone={router.invalidate}
          />
          <RateCard t={t} data={data} date={date} canEdit={canEdit} onDone={router.invalidate} />
          <SettingsCard t={t} data={data} canEdit={canEdit} onDone={router.invalidate} />
          <PersonaCard t={t} data={data} canEdit={canEdit} onDone={router.invalidate} />
          <Card title={t("pricelist.usage.title")}>
            <p className="text-sm">
              {data.usage.messages
                ? t("pricelist.usage.summary", {
                    messages: data.usage.messages,
                    usd: data.usage.usd.toFixed(2),
                    per: data.usage.usdPerMessage.toFixed(4),
                    share: Math.round(data.usage.cacheReadShare * 100),
                  })
                : t("pricelist.usage.empty")}
            </p>
          </Card>
        </div>
        <div className="space-y-4">
          <TasksCard t={t} data={data} canEdit={canEdit} date={date} />
          <MediaCard t={t} data={data} canEdit={canEdit} onDone={router.invalidate} />
          <KnowledgeCard t={t} data={data} canEdit={canEdit} onDone={router.invalidate} />
        </div>
      </div>
    </>
  );
}
