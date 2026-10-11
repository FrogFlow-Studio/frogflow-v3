import { useRouteContext } from "@tanstack/react-router";
import { courseFn } from "@/app/admin/courses.functions";
import { useEffect, useState } from "react";
import { audienceCountFn } from "@/app/admin/broadcasts.functions";
import { type AdminKey } from "@/app/i18n/admin";
import { ProductPicker } from "@/app/admin/product-picker";
import { SEGMENT_KINDS } from "@/core/broadcasts/segments";
import {
  AUDIENCES,
  type Channel,
  type Data,
  LANGUAGES,
  SALES_SEGMENTS,
  type SegmentDraft,
  type SegmentKind,
  type UiAudience,
  useT,
} from "./shared";
import { HelpTip } from "@/app/admin/help-panel";

export function useAudienceCount(
  channel: Channel,
  audience: UiAudience,
  country: string,
  segment?: Record<string, unknown>,
) {
  const [count, setCount] = useState<number | null>(null);
  const segKey = JSON.stringify(segment ?? null);
  useEffect(() => {
    let cancelled = false;
    setCount(null);
    if (audience === "segment" && !segment) {
      setCount(0);
      return;
    }
    void audienceCountFn({
      data: {
        channel,
        audience: audience === "segment" ? "all" : audience,
        countryCode: audience === "country" ? country : undefined,
        segment: audience === "segment" ? segment : undefined,
      },
    })
      .then((r) => {
        if (!cancelled) setCount(r.count);
      })
      .catch(() => {
        if (!cancelled) setCount(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, audience, country, segKey]);
  return count;
}

/** Выбор сегмента: что купили, давность, язык, корзина, тег продавца. */
function SegmentPicker({
  data,
  value,
  onChange,
}: {
  data: Data;
  value: SegmentDraft;
  onChange: (v: SegmentDraft) => void;
}) {
  const t = useT();
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  const set = (patch: Partial<SegmentDraft>) => onChange({ ...value, ...patch });
  // Потоки выбранного курса — для «ученики потока».
  const [cohorts, setCohorts] = useState<Array<{ id: string; title: string }>>([]);
  useEffect(() => {
    if (value.kind !== "course" || !value.productId) return setCohorts([]);
    void courseFn({ data: { productId: value.productId } }).then(
      (c) => setCohorts((c.cohorts ?? []).map((k) => ({ id: k.id, title: k.title || k.start }))),
      () => setCohorts([]),
    );
  }, [value.kind, value.productId]);
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      <select
        className="input"
        aria-label={t("broadcasts.segment.kind")}
        value={value.kind}
        onChange={(e) => set({ kind: e.target.value as SegmentKind })}
      >
        {SEGMENT_KINDS.filter(
          (k) =>
            (k !== "course" || shop.modules.courses) &&
            (shop.sells !== false || !SALES_SEGMENTS.includes(k)),
        ).map((k) => (
          <option key={k} value={k}>
            {t(`broadcasts.segment.${k}` as AdminKey)}
          </option>
        ))}
      </select>
      {value.kind === "course" && (
        <>
          <div aria-label={t("broadcasts.segment.pickProduct")}>
            <ProductPicker
              t={t}
              value={
                value.productId
                  ? { id: value.productId, name: value.productName, price: 0, currency: "" }
                  : null
              }
              onChange={(p) =>
                set({ productId: p?.id ?? "", productName: p?.name ?? "", cohortId: "" })
              }
            />
          </div>
          <select
            className="input"
            value={value.who}
            onChange={(e) => set({ who: e.target.value as SegmentDraft["who"] })}
          >
            {(["all", "behind", "homework", "completed"] as const).map((w) => (
              <option key={w} value={w}>
                {t(`broadcasts.segment.who.${w}`)}
              </option>
            ))}
          </select>
          {cohorts.length > 0 && (
            <select
              className="input"
              value={value.cohortId}
              onChange={(e) => set({ cohortId: e.target.value })}
            >
              <option value="">{t("broadcasts.segment.allCohorts")}</option>
              {cohorts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          )}
        </>
      )}
      {value.kind === "product" && (
        <div aria-label={t("broadcasts.segment.pickProduct")}>
          <ProductPicker
            t={t}
            value={
              value.productId
                ? { id: value.productId, name: value.productName, price: 0, currency: "" }
                : null
            }
            onChange={(p) => set({ productId: p?.id ?? "", productName: p?.name ?? "" })}
          />
        </div>
      )}
      {value.kind === "category" && (
        <select
          className="input"
          value={value.categoryId}
          onChange={(e) => set({ categoryId: e.target.value })}
        >
          <option value="">{t("broadcasts.segment.pickCategory")}</option>
          {data.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      {value.kind === "inactive" && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="number"
            className="input w-24"
            min={1}
            max={3650}
            value={value.days}
            onChange={(e) => set({ days: e.target.value })}
          />
          {t("broadcasts.segment.days")}
        </label>
      )}
      {value.kind === "language" && (
        <select
          className="input"
          value={value.locale}
          onChange={(e) => set({ locale: e.target.value })}
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      )}
      {value.kind === "tag" && (
        <input
          className="input"
          placeholder={t("broadcasts.segment.tagPlaceholder")}
          value={value.tag}
          maxLength={32}
          onChange={(e) => set({ tag: e.target.value })}
        />
      )}
    </div>
  );
}

export function AudiencePicker({
  channel,
  data,
  audience,
  setAudience,
  country,
  setCountry,
  count,
  segment,
  setSegment,
}: {
  channel: Channel;
  data: Data;
  audience: UiAudience;
  setAudience: (a: UiAudience) => void;
  country: string;
  setCountry: (c: string) => void;
  count: number | null;
  segment?: SegmentDraft;
  setSegment?: (s: SegmentDraft) => void;
}) {
  const t = useT();
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  const sells = shop.sells !== false;
  return (
    <div>
      <span className="label flex items-center gap-1.5">
        {t("broadcasts.audience.label")}
        <HelpTip article="broadcasts" anchor="audience" />
      </span>
      <div className="grid gap-2 sm:grid-cols-2">
        {AUDIENCES.filter(
          (a) => (channel === "telegram" || !a.tgOnly) && (sells || !a.sellsOnly),
        ).map((a) => (
          <label
            key={a.value}
            className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm ${audience === a.value ? "border-accent bg-accent/10" : "border-line"}`}
          >
            <input
              type="radio"
              name={`audience-${channel}`}
              className="mt-1"
              checked={audience === a.value}
              onChange={() => setAudience(a.value)}
            />
            <span>
              <span className="font-medium">{t(a.label)}</span>
              <span className="block text-xs text-muted">{t(a.hint)}</span>
            </span>
          </label>
        ))}
      </div>
      {audience === "country" && (
        <select className="input mt-2" value={country} onChange={(e) => setCountry(e.target.value)}>
          {Object.keys(data.countries).length === 0 && (
            <option value="">{t("broadcasts.audience.noCountries")}</option>
          )}
          {Object.entries(data.countries)
            .sort((a, b) => b[1] - a[1])
            .map(([code, n]) => (
              <option key={code} value={code}>
                {code} — {n}
              </option>
            ))}
        </select>
      )}
      {audience === "segment" && segment && setSegment && (
        <SegmentPicker data={data} value={segment} onChange={setSegment} />
      )}
      {audience === "test" && !data.hasAdminChat && (
        <p className="mt-2 text-xs text-danger">{t("broadcasts.audience.noAdminChat")}</p>
      )}
      <p className="mt-2 text-sm text-muted">
        {t("broadcasts.audience.recipients")}{" "}
        <span className="font-medium text-fg tabular-nums">{count ?? "…"}</span>
      </p>
    </div>
  );
}
