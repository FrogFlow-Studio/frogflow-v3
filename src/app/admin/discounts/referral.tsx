import { useRouteContext, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { saveSettingsFn } from "@/app/admin/settings.functions";
import { adminT } from "@/app/i18n/admin";
import { Card, Empty, ErrorBox, Field, useAction } from "@/app/ui";
import { referralReportFn } from "@/app/admin/loyalty.functions";
import { HelpTip } from "@/app/admin/help-panel";

/** Реферальная скидка и отчёт по приглашениям. */

export function ReferralCard({ percent, bot }: { percent: string; bot: string | null }) {
  const router = useRouter();
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  const t = adminT(shop.locale);
  const [value, setValue] = useState(percent);
  const save = useAction(async () => {
    await saveSettingsFn({ data: { referral_discount_percent: value.trim() } });
    await router.invalidate();
  });
  return (
    <Card
      title={t("discounts.referral.title")}
      help={<HelpTip article="discounts" anchor="referral" />}
    >
      <p className="mb-3 text-sm text-muted">
        {t("discounts.referral.intro", { link: bot ? ` (t.me/${bot}?start=ref_…)` : "" })}
      </p>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run().catch(() => {});
        }}
      >
        <Field label={t("discounts.referral.percent")}>
          <input
            className="input w-32"
            type="number"
            min={1}
            max={100}
            step={1}
            placeholder="10"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        <button className="btn-secondary" disabled={save.busy}>
          {t("common.save")}
        </button>
      </form>
      <ErrorBox error={save.error} />
    </Card>
  );
}

/** Отчёт «Рефералы»: кто привёл друзей, сколько купили, какие коды выданы; CSV. */
export function ReferralReportCard() {
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  const t = adminT(shop.locale);
  const [report, setReport] = useState<Awaited<ReturnType<typeof referralReportFn>>>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    // null — роли не хватает (отчёт видит менеджер и владелец); сбой чтения показываем.
    referralReportFn().then(setReport).catch(setError);
  }, []);
  if (error)
    return (
      <Card title={t("discounts.referral.report.title")} className="lg:col-span-2">
        <ErrorBox error={error} />
      </Card>
    );
  if (!report) return null;
  return (
    <Card title={t("discounts.referral.report.title")} className="lg:col-span-2">
      <p className="mb-3 text-sm text-muted">
        {t("discounts.referral.report.totals", {
          came: report.last30.came,
          bought: report.last30.bought,
          tc: report.total.came,
          tb: report.total.bought,
        })}{" "}
        <a className="underline" href="/api/admin/export/referrals">
          {t("discounts.referral.report.csv")}
        </a>
      </p>
      {report.rows.length === 0 ? (
        <Empty>{t("discounts.referral.report.empty")}</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1 pr-3">{t("discounts.referral.report.who")}</th>
                <th className="py-1 pr-3">{t("discounts.referral.report.came")}</th>
                <th className="py-1 pr-3">{t("discounts.referral.report.bought")}</th>
                <th className="py-1">{t("discounts.referral.report.codes")}</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.referrerId} className="border-t border-line align-top">
                  <td className="py-1 pr-3">{r.name}</td>
                  <td className="py-1 pr-3">{r.came}</td>
                  <td className="py-1 pr-3">{r.bought}</td>
                  <td className="py-1">
                    {r.codes.map((c) => (
                      <div key={c.code}>
                        <code>{c.code}</code>
                        {c.used ? ` — ${t("discounts.referral.report.used")}` : ""}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
