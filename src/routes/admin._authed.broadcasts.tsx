import { EngageBlock } from "@/app/admin/engage-block";
import { SimilarCard } from "@/app/admin/similar-card";
import { AutoStatsBlock } from "@/app/admin/auto-stats";
import { GiveawaysCard } from "@/app/admin/giveaways-card";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { broadcastsFn } from "@/app/admin/broadcasts.functions";
import { adminT, intlLocale } from "@/app/i18n/admin";
import { Card, Empty, PageTitle } from "@/app/ui";
import { type Channel } from "@/app/admin/broadcasts/shared";
import { Composer, WhatsAppComposer } from "@/app/admin/broadcasts/composer";
import { TemplatesCard, ExcludedPhonesCard } from "@/app/admin/broadcasts/templates";
import {
  MarketingCapCard,
  CartReminderCard,
  WinbackCard,
  FunnelCard,
  BirthdayCard,
} from "@/app/admin/broadcasts/auto-cards";
import { History } from "@/app/admin/broadcasts/history";

/** Рассылки продавца: страница; части формы, история и автосообщения — в app/admin/broadcasts/. */

export const Route = createFileRoute("/admin/_authed/broadcasts")({
  // Готовый сегмент из аналитики (?segment=inactive&days=60): подставляется в форму, не отправляется.
  validateSearch: (s: Record<string, unknown>) => ({
    segment: s.segment === "inactive" ? ("inactive" as const) : undefined,
    days: Number.isInteger(Number(s.days)) && Number(s.days) > 0 ? Number(s.days) : undefined,
    // «Дослать не купившим» из истории: id рассылки, у которой берём не заказавших.
    followup:
      typeof s.followup === "string" && /^[0-9a-f-]{36}$/i.test(s.followup)
        ? s.followup
        : undefined,
  }),
  loader: () => broadcastsFn(),
  component: BroadcastsPage,
});

function BroadcastsPage() {
  const data = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const router = useRouter();
  const [channel, setChannel] = useState<Channel>(data.telegramModule ? "telegram" : "whatsapp");
  // Запланированная на будущее рассылка форму не блокирует и опрос не включает.
  const activeIn = (c: Channel) =>
    data.broadcasts.some((b) => {
      if (b.channel !== c || (b.status !== "queued" && b.status !== "sending")) return false;
      const at = (b.audience_filter as { send_at?: string } | null)?.send_at;
      return b.status === "sending" || !at || Date.parse(at) <= Date.now();
    });
  const anyActive = activeIn("telegram") || activeIn("whatsapp");

  // Пока рассылка идёт — обновляем список раз в 5 секунд.
  useEffect(() => {
    if (!anyActive) return;
    const t = setInterval(() => void router.invalidate(), 5000);
    return () => clearInterval(t);
  }, [anyActive, router]);

  const both = data.telegramModule && data.whatsapp;
  // Консультант без продаж (BOVI): корзины, покупок и «вернуть покупателя» у него нет.
  const sells = shop.sells !== false;
  return (
    <>
      <PageTitle
        title={t("broadcasts.title")}
        subtitle={
          channel === "telegram"
            ? t("broadcasts.subtitle.telegram")
            : t("broadcasts.subtitle.whatsapp")
        }
      />
      {both && (
        <div className="mb-4 flex gap-2">
          {(["telegram", "whatsapp"] as const).map((c) => (
            <button
              key={c}
              type="button"
              className={channel === c ? "btn-primary text-sm" : "btn-secondary text-sm"}
              onClick={() => setChannel(c)}
            >
              {c === "telegram" ? "Telegram" : "WhatsApp"}
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {channel === "telegram" && data.telegramModule ? (
          <Composer data={data} botId={shop.botId} disabled={activeIn("telegram")} />
        ) : data.whatsapp ? (
          <div className="space-y-4">
            <WhatsAppComposer data={data} wa={data.whatsapp} disabled={activeIn("whatsapp")} />
            <TemplatesCard wa={data.whatsapp} />
            <ExcludedPhonesCard phones={data.whatsapp.excludedPhones} />
          </div>
        ) : (
          <Card title={t("broadcasts.title")}>
            <Empty>{t("broadcasts.moduleOff")}</Empty>
          </Card>
        )}
        <div className="space-y-4">
          {((sells && (shop.modules.cart_reminder || shop.modules.winback)) ||
            shop.modules.funnel) && <MarketingCapCard cap={data.marketingCap} />}
          {sells && shop.modules.cart_reminder && (
            <CartReminderCard hours={data.cartReminderHours} stats={data.autoStats?.cart} />
          )}
          {sells && shop.modules.winback && <WinbackCard stats={data.autoStats?.winback} />}
          {sells && shop.modules.waitlist && (
            <Card title={t("autostats.waitlistTitle")}>
              <AutoStatsBlock t={t} stats={data.autoStats?.waitlist} />
            </Card>
          )}
          {sells && shop.modules.winback && <SimilarCard t={t} stats={data.autoStats?.similar} />}
          {sells && (shop.modules.quiz || shop.modules.upsell) && (
            <Card title={t("engage.title")}>
              <EngageBlock
                t={t}
                stats={data.engage ?? undefined}
                quiz={Boolean(shop.modules.quiz)}
                upsell={Boolean(shop.modules.upsell)}
              />
            </Card>
          )}
          {shop.modules.funnel && <FunnelCard />}
          {shop.modules.funnel && <BirthdayCard />}
          {shop.modules.giveaways && <GiveawaysCard t={t} locale={intlLocale(shop.locale)} />}
          <History
            broadcasts={data.broadcasts}
            total={data.broadcastsTotal}
            onlyChannel={both ? channel : null}
            showChannel={!both}
          />
        </div>
      </div>
    </>
  );
}
