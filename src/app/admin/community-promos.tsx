import { useEffect, useState } from "react";
import {
  acceptJointPromoFn,
  createJointPromoFn,
  declineJointPromoFn,
  jointPromosFn,
} from "@/app/admin/community-promos.functions";
import type { AdminKey, AdminT } from "@/app/i18n/admin";
import { Card, Empty, ErrorBox, Field, useAction } from "@/app/ui";
import { HelpTip } from "@/app/admin/help-panel";

type Data = Extract<Awaited<ReturnType<typeof jointPromosFn>>, { soon: false }>;
type Promo = Data["promos"][number];

const emptyTerms = { code: "", percent: "", conditions: "" };

function Terms({
  value,
  onChange,
  t,
}: {
  value: typeof emptyTerms;
  onChange: (v: typeof emptyTerms) => void;
  t: AdminT;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t("community.joint.code")}>
        <input
          className="input"
          maxLength={30}
          value={value.code}
          onChange={(e) => onChange({ ...value, code: e.target.value })}
        />
      </Field>
      <Field label={t("community.joint.percent")}>
        <input
          className="input"
          inputMode="numeric"
          value={value.percent}
          onChange={(e) => onChange({ ...value, percent: e.target.value })}
        />
      </Field>
      <div className="sm:col-span-2">
        <Field label={t("community.joint.conditions")}>
          <input
            className="input"
            maxLength={300}
            value={value.conditions}
            onChange={(e) => onChange({ ...value, conditions: e.target.value })}
          />
        </Field>
      </div>
    </div>
  );
}

const termsPayload = (v: typeof emptyTerms) => ({
  code: v.code,
  percent: Number(v.percent),
  conditions: v.conditions,
});

/** Совместные акции: предложения, ответ «согласиться / отказаться», свои условия. Без таблицы не рисуется. */
export function CommunityPromos({
  canWrite,
  loc,
  t,
}: {
  canWrite: boolean;
  loc: string;
  t: AdminT;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useAction(async () => {
    const r = await jointPromosFn();
    if (!r.soon) setData(r);
  });
  useEffect(() => {
    void load.run().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {t("community.joint.intro")} <HelpTip article="community" anchor="joint" />
      </p>
      <ErrorBox error={load.error} />
      {canWrite && (
        <button className="btn-primary" onClick={() => setCreating((v) => !v)}>
          {t("community.joint.new")}
        </button>
      )}
      {creating && data && (
        <NewPromo
          partners={data.partners}
          t={t}
          onDone={() => {
            setCreating(false);
            void load.run().catch(() => {});
          }}
        />
      )}
      {data && data.promos.length === 0 && <Empty>{t("community.joint.empty")}</Empty>}
      {data?.promos.map((p) => (
        <PromoCard
          key={p.id}
          p={p}
          canWrite={canWrite}
          loc={loc}
          t={t}
          onDone={() => void load.run().catch(() => {})}
        />
      ))}
    </div>
  );
}

function NewPromo({
  partners,
  t,
  onDone,
}: {
  partners: Data["partners"];
  t: AdminT;
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [terms, setTerms] = useState(emptyTerms);
  const save = useAction(async () => {
    const r = await createJointPromoFn({
      data: {
        title,
        // Конец выбранного дня: акция идёт весь последний день.
        endsAt: endsAt ? new Date(`${endsAt}T23:59:59`).toISOString() : "",
        partnerIds: picked,
        terms: termsPayload(terms),
      },
    });
    if (!r.soon) onDone();
  });
  return (
    <Card title={t("community.joint.new")}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run().catch(() => {});
        }}
      >
        <Field label={t("community.joint.title")}>
          <input
            className="input"
            maxLength={80}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label={t("community.joint.ends")}>
          <input
            type="date"
            className="input w-48"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
          />
        </Field>
        <div>
          <div className="mb-1 text-sm font-medium">{t("community.joint.partners")}</div>
          {partners.length === 0 && (
            <p className="text-sm text-muted">{t("community.joint.noPartners")}</p>
          )}
          {partners.map((a) => (
            <label key={a.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={picked.includes(a.id)}
                disabled={!picked.includes(a.id) && picked.length >= 2}
                onChange={(e) =>
                  setPicked((p) => (e.target.checked ? [...p, a.id] : p.filter((x) => x !== a.id)))
                }
              />
              {a.name}
            </label>
          ))}
        </div>
        <div className="text-sm font-medium">{t("community.joint.myTerms")}</div>
        <Terms value={terms} onChange={setTerms} t={t} />
        <button className="btn-primary" disabled={save.busy || picked.length === 0}>
          {t("community.joint.create")}
        </button>
        <ErrorBox error={save.error} />
      </form>
    </Card>
  );
}

function PromoCard({
  p,
  canWrite,
  loc,
  t,
  onDone,
}: {
  p: Promo;
  canWrite: boolean;
  loc: string;
  t: AdminT;
  onDone: () => void;
}) {
  const [terms, setTerms] = useState(emptyTerms);
  const [started, setStarted] = useState(false);
  const accept = useAction(async () => {
    const r = await acceptJointPromoFn({ data: { promoId: p.id, terms: termsPayload(terms) } });
    if (!r.soon && r.active) setStarted(true);
    onDone();
  });
  const decline = useAction(async () => {
    await declineJointPromoFn({ data: { promoId: p.id } });
    onDone();
  });
  const open = p.status === "proposed";
  return (
    <Card title={p.title}>
      <p className="text-sm text-muted">
        {t(`community.joint.status.${p.status}` as AdminKey)} ·{" "}
        {t("community.joint.until", { date: new Date(p.endsAt).toLocaleDateString(loc) })}
      </p>
      <ul className="mt-2 space-y-1 text-sm">
        {p.members.map((m, i) => (
          <li key={i}>
            <span className="font-medium">
              {m.name}
              {m.mine ? ` (${t("community.joint.you")})` : ""}
            </span>{" "}
            · {t(`community.joint.member.${m.status}` as AdminKey)}
            {m.code && m.percent ? ` · ${m.code}, ${m.percent} %` : ""}
            {m.conditions ? ` · ${m.conditions}` : ""}
          </li>
        ))}
      </ul>
      {started && <p className="mt-2 text-sm text-ok">{t("community.joint.started")}</p>}
      {canWrite && p.needsAnswer && (
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void accept.run().catch(() => {});
          }}
        >
          <p className="text-xs text-muted">{t("community.joint.acceptHint")}</p>
          <Terms value={terms} onChange={setTerms} t={t} />
          <div className="flex gap-2">
            <button className="btn-primary" disabled={accept.busy || decline.busy}>
              {t("community.joint.accept")}
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={accept.busy || decline.busy}
              onClick={() => void decline.run().catch(() => {})}
            >
              {t("community.joint.decline")}
            </button>
          </div>
        </form>
      )}
      {canWrite && open && !p.needsAnswer && (
        <button
          className="btn-ghost mt-3 text-danger"
          disabled={decline.busy}
          onClick={() => void decline.run().catch(() => {})}
        >
          {t("community.joint.cancel")}
        </button>
      )}
      <ErrorBox error={accept.error ?? decline.error} />
    </Card>
  );
}
