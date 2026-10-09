import { useState } from "react";
import { refreshPricelistRateFn, setPricelistRateFn } from "../pricelist.functions";
import { Badge, Card, ErrorBox, Field, useAction } from "@/app/ui";
import { type AdminKey, type AdminT } from "@/app/i18n/admin";
import type { RateAttempt } from "@/core/consultant/pricelist/rate-attempts";
import { type CardProps } from "./shared";

/** Курс валюты прайса. */

/** Строка журнала попытки курса на языке продавца. */
export function rateAttemptText(t: AdminT, a: RateAttempt): string {
  const vars = Object.fromEntries(
    Object.entries(a.vars ?? {}).map(([k, v]) => [k, String(v)]),
  ) as Record<string, string>;
  let body = t(`pricelist.rate.attempt.${a.code}` as AdminKey, vars);
  if (a.code === "ok" && vars.sell) body += t("pricelist.rate.attempt.okSell", vars);
  if (a.code === "ok" && vars.updated) body += t("pricelist.rate.attempt.okUpdated", vars);
  if (!a.src) return body;
  const src = a.via ? t(`pricelist.rate.attempt.via.${a.via}` as AdminKey, { src: a.src }) : a.src;
  return `${src}: ${body}`;
}

export function RateCard({
  t,
  data,
  date,
  canEdit,
  onDone,
}: CardProps & { date: (s: string) => string }) {
  const [manual, setManual] = useState("");
  const [failed, setFailed] = useState(false);
  const refresh = useAction(async () => {
    const r = await refreshPricelistRateFn();
    setFailed(!r.fetched && r.error !== "manual");
    await onDone();
  });
  const save = useAction(async () => {
    await setPricelistRateFn({ data: { rate: Number(manual.replace(",", ".")) } });
    setManual("");
    await onDone();
  });
  const rate = data.rate;
  return (
    <Card title={t("pricelist.rate.title")}>
      {rate ? (
        <>
          <p className="text-lg font-semibold">
            {t("pricelist.rate.current", { rate: rate.rate })}{" "}
            {!rate.fresh && <Badge tone="warn">!</Badge>}
          </p>
          <p className="text-sm text-muted">
            {t("pricelist.rate.updated", { date: date(rate.updatedAt), source: rate.source })}
          </p>
          {!rate.fresh && <p className="mt-2 text-sm text-warn">{t("pricelist.rate.stale")}</p>}
        </>
      ) : (
        <p className="text-sm text-warn">{t("pricelist.rate.none")}</p>
      )}
      {failed && <p className="mt-2 text-sm text-warn">{t("pricelist.rate.failed")}</p>}
      {data.attempt && !data.attempt.ok && data.attempt.attempts.length > 0 && (
        <details className="mt-2 text-xs text-muted">
          <summary>{t("pricelist.rate.lastAttempt", { date: date(data.attempt.at) })}</summary>
          <ul className="list-disc pl-5">
            {/* Коды — на языке продавца; старый журнал (и журнал v1) — строками как есть. */}
            {data.attempt.entries
              ? data.attempt.entries.map((a, i) => <li key={i}>{rateAttemptText(t, a)}</li>)
              : data.attempt.attempts.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </details>
      )}
      {canEdit && (
        <div className="mt-3 space-y-3">
          {data.rateSource !== "manual" && (
            <button
              className="btn-secondary"
              disabled={refresh.busy}
              onClick={() => void refresh.run().catch(() => {})}
            >
              {t("pricelist.rate.refresh")}
            </button>
          )}
          <Field label={t("pricelist.rate.manual")} hint={t("pricelist.rate.manualHint")}>
            <div className="flex gap-2">
              <input
                className="input w-32"
                inputMode="decimal"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
              />
              <button
                className="btn-secondary"
                disabled={save.busy || !manual.trim()}
                onClick={() => void save.run().catch(() => {})}
              >
                {t("pricelist.rate.setManual")}
              </button>
            </div>
          </Field>
        </div>
      )}
      <ErrorBox error={refresh.error ?? save.error} />
    </Card>
  );
}
