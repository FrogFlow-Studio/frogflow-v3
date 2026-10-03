import { useEffect, useState } from "react";
import { ErrorBox } from "@/app/ui";
import { formatMoney } from "@/core/money/money";
import type { MyRewards } from "@/core/storefront/my-rewards";
import { useStorefrontLocale } from "./locale";

/**
 * «Мои баллы и приглашения» над списком заказов: баланс, уровень, личная
 * ссылка-приглашение и итоги. Данные приходят отдельным запросом, чтобы не
 * задерживать список заказов; нечего показывать (нет ни баллов, ни рефералов
 * у магазина) — блока нет.
 */
export function MyRewardsBox({ load }: { load: () => Promise<MyRewards | null> }) {
  const { t } = useStorefrontLocale();
  const [data, setData] = useState<MyRewards | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    load().then(setData, setError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (error) return <ErrorBox error={error} />;
  if (!data || (!data.points && !data.invite)) return null;
  const { points, invite } = data;
  const copy = () => {
    if (!invite) return;
    navigator.clipboard.writeText(invite.link).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {},
    );
  };
  return (
    <section className="space-y-3 rounded-md border border-line p-3 text-sm">
      <h2 className="font-semibold">{t("rewards.title")}</h2>
      {points && (
        <div className="space-y-1">
          <p>
            {points.balance > 0
              ? t("rewards.balance", { n: points.balance, cur: points.currency })
              : t("rewards.none", { p: points.earnPercent })}
          </p>
          {points.tier && (
            <p className="text-muted">
              {t("rewards.tier", { name: points.tier.name, p: points.tier.percent })}
              {points.next &&
                `. ${t("rewards.tierNext", {
                  name: points.next.name,
                  amount: formatMoney(points.next.remaining, points.currency),
                })}`}
            </p>
          )}
          {points.balance > 0 && points.maxRedeemPercent > 0 && (
            <p className="text-xs text-muted">
              {t("rewards.spend", { p: points.maxRedeemPercent })}
            </p>
          )}
        </div>
      )}
      {invite && (
        <div className="space-y-2">
          <h3 className="font-medium">{t("rewards.invite.title")}</h3>
          <p className="text-xs text-muted">{t("rewards.invite.text")}</p>
          <p className="break-all rounded bg-surface-2 px-2 py-1 text-xs">{invite.link}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={copy}
              className="rounded-md border border-line px-3 py-1 text-xs hover:bg-surface-2"
            >
              {copied ? t("rewards.invite.copied") : t("rewards.invite.copy")}
            </button>
            <a
              href={`https://t.me/share/url?url=${encodeURIComponent(invite.link)}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-line px-3 py-1 text-xs hover:bg-surface-2"
            >
              {t("rewards.invite.share")}
            </a>
          </div>
          <p className="text-xs">
            {t("rewards.invite.stats", { came: invite.came, bought: invite.bought })}
          </p>
          {invite.codes.length > 0 && (
            <div className="text-xs">
              <p className="text-muted">{t("rewards.invite.codes")}</p>
              <ul>
                {invite.codes.map((c) => (
                  <li key={c.code}>
                    <code>{c.code}</code>
                    {c.used ? ` — ${t("rewards.invite.used")}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
