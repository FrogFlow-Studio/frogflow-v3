import { createFileRoute } from "@tanstack/react-router";
import { storeGiveawayFn } from "@/app/storefront/giveaway.functions";
import { useStorefrontLocale } from "@/app/storefront/locale";
import { intlLocale } from "@/app/i18n/admin";

/** Итоги розыгрыша: условия, число участников, победители со скрытыми именами, зерно и хеш для проверки. */
export const Route = createFileRoute("/s/$slug/giveaway/$id")({
  loader: ({ params }) => storeGiveawayFn({ data: { slug: params.slug, id: params.id } }),
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  component: GiveawayPage,
});

function GiveawayPage() {
  const g = Route.useLoaderData();
  const { t, locale } = useStorefrontLocale();
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(intlLocale(locale), {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  const accepting = g.status === "open" && Date.parse(g.endsAt) > Date.now();
  return (
    <article className="mx-auto max-w-xl space-y-4">
      <h1 className="text-xl font-semibold text-balance">{g.title}</h1>
      {!g.result && (
        <p className="text-sm text-muted">
          {accepting
            ? `${t("giveaway.open")} · ${t("giveaway.ends", { date: fmt(g.endsAt) })}`
            : t("giveaway.closed")}
        </p>
      )}
      <section>
        <h2 className="text-sm font-medium">{t("giveaway.prize")}</h2>
        <p className="text-sm">{g.prize}</p>
      </section>
      {g.conditions && (
        <section>
          <h2 className="text-sm font-medium">{t("giveaway.conditions")}</h2>
          <p className="text-sm whitespace-pre-line">{g.conditions}</p>
        </section>
      )}
      <p className="text-sm text-muted tabular-nums">
        {t("giveaway.entered", { n: g.entered })} ·{" "}
        {t("giveaway.winnersCount", { n: g.winnersCount })}
      </p>
      {g.result && (
        <>
          <section>
            <h2 className="text-sm font-medium">{t("giveaway.winners")}</h2>
            {g.result.winners.length === 0 ? (
              <p className="text-sm text-muted">{t("giveaway.noWinners")}</p>
            ) : (
              <ol className="list-decimal pl-5 text-sm">
                {g.result.winners.map((name, i) => (
                  <li key={i}>{name}</li>
                ))}
              </ol>
            )}
          </section>
          <section className="space-y-1 rounded-md border border-line p-3 text-xs">
            <h2 className="text-sm font-medium">{t("giveaway.verify")}</h2>
            <p className="text-muted">{t("giveaway.verifyText", { n: g.result.eligible })}</p>
            <p>
              {t("giveaway.seed")}: <code className="break-all">{g.result.seed}</code>
            </p>
            <p>
              {t("giveaway.hash")}: <code className="break-all">{g.result.listHash}</code>
            </p>
            <p className="text-muted">{t("giveaway.drawnAt", { date: fmt(g.result.drawnAt) })}</p>
          </section>
        </>
      )}
    </article>
  );
}
