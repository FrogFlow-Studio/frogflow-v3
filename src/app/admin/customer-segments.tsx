import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  customerSegmentsFn,
  deleteCustomerSegmentFn,
  saveCustomerSegmentFn,
  segmentMembersFn,
} from "@/app/admin/segments.functions";
import { adminT, intlLocale, type AdminKey } from "@/app/i18n/admin";
import { Badge, ErrorBox, useAction } from "@/app/ui";
import type { CustomerSegment, SegmentMember, SegmentRule } from "@/core/customers/saved-segments";

type T = ReturnType<typeof adminT>;

const PRESET_NAME: Record<string, AdminKey> = {
  "preset:orders2": "seg.preset.orders2",
  "preset:inactive60": "seg.preset.inactive60",
  "preset:vip": "seg.preset.vip",
};

type Active = { segment: CustomerSegment; label: string };
type Result = { total: number; members: SegmentMember[] };

/**
 * Сегменты покупателей на странице «Покупатели»: готовые и сохранённые
 * чипами, по нажатию — кто входит (без контактов). `onActive` сообщает
 * странице, что вместо общего списка показан сегмент.
 */
export function CustomerSegments({
  t,
  locale,
  canWrite,
  onActive,
}: {
  t: T;
  locale: string;
  canWrite: boolean;
  onActive: (active: boolean) => void;
}) {
  const loc = intlLocale(locale as never);
  const [lists, setLists] = useState<{
    presets: readonly CustomerSegment[];
    saved: CustomerSegment[];
  } | null>(null);
  const [active, setActive] = useState<Active | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [kind, setKind] = useState<SegmentRule["kind"]>("orders_min");
  const [value, setValue] = useState("");
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);

  const reload = async () => setLists(await customerSegmentsFn());
  useEffect(() => {
    void reload().catch(() => {});
  }, []);

  const open = useAction(async (segment: CustomerSegment, label: string) => {
    setActive({ segment, label });
    setResult(null);
    onActive(true);
    setResult(await segmentMembersFn({ data: { rule: segment.rule } }));
  });
  const close = () => {
    setActive(null);
    setResult(null);
    onActive(false);
  };
  const ruleFromForm = (): SegmentRule | null => {
    if (kind === "tag") return value.trim() ? { kind, tag: value.trim() } : null;
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 1) return null;
    return kind === "orders_min" ? { kind, min: n } : { kind, days: n };
  };
  const save = useAction(async () => {
    const rule = ruleFromForm();
    if (!rule) return;
    await saveCustomerSegmentFn({ data: { name, rule } });
    setSaved(true);
    setName("");
    setValue("");
    await reload();
  });
  const remove = useAction(async (id: string) => {
    await deleteCustomerSegmentFn({ data: { id } });
    if (active?.segment.id === id) close();
    await reload();
  });

  const all = lists ? [...lists.presets, ...lists.saved] : [];
  const label = (s: CustomerSegment) => (PRESET_NAME[s.id] ? t(PRESET_NAME[s.id]!) : s.name);
  return (
    <section className="mb-4" aria-label={t("seg.title")}>
      <h2 className="mb-1 text-sm font-medium text-muted">{t("seg.title")}</h2>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {all.map((s) => (
          <span key={s.id} className="inline-flex items-center">
            <button
              type="button"
              className={`btn-secondary text-sm ${active?.segment.id === s.id ? "font-medium text-accent" : ""}`}
              aria-pressed={active?.segment.id === s.id}
              disabled={open.busy}
              onClick={() => void open.run(s, label(s)).catch(() => {})}
            >
              {label(s)}
            </button>
            {canWrite && !s.id.startsWith("preset:") && (
              <button
                type="button"
                className="btn-ghost px-1 text-xs text-danger"
                aria-label={`${t("seg.delete")}: ${s.name}`}
                disabled={remove.busy}
                onClick={() => void remove.run(s.id).catch(() => {})}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {active && (
          <button type="button" className="btn-ghost text-sm" onClick={close}>
            {t("seg.showAll")}
          </button>
        )}
      </div>
      <p className="mb-2 text-xs text-muted">{t("seg.hint")}</p>
      <ErrorBox error={open.error ?? remove.error} />
      {canWrite && (
        <form
          className="mb-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSaved(false);
            void save.run().catch(() => {});
          }}
        >
          <input
            className="input w-48"
            aria-label={t("seg.name")}
            placeholder={t("seg.name")}
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <select
            className="input w-auto"
            aria-label={t("seg.kind.orders_min")}
            value={kind}
            onChange={(e) => setKind(e.target.value as SegmentRule["kind"])}
          >
            <option value="orders_min">{t("seg.kind.orders_min")}</option>
            <option value="inactive">{t("seg.kind.inactive")}</option>
            <option value="tag">{t("seg.kind.tag")}</option>
          </select>
          <input
            className="input w-32"
            aria-label={t("seg.value")}
            placeholder={t("seg.value")}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <button className="btn-secondary text-sm" disabled={save.busy || !name.trim()}>
            {t("seg.save")}
          </button>
          {saved && <span className="text-xs text-ok">{t("seg.saved")}</span>}
        </form>
      )}
      <ErrorBox error={save.error} />
      {active && result && (
        <div>
          <p className="mb-2 text-sm">
            <span className="font-medium">{active.label}</span> ·{" "}
            {t("seg.members", { n: result.total })}
            {result.total > result.members.length &&
              ` · ${t("seg.shownFirst", { n: result.members.length })}`}
          </p>
          {result.members.length === 0 ? (
            <p className="text-sm text-muted">{t("seg.empty")}</p>
          ) : (
            <div className="card overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("customers.col.customer")}</th>
                    <th>{t("customers.col.channel")}</th>
                    <th className="text-right">{t("seg.col.orders")}</th>
                    <th>{t("seg.col.last")}</th>
                    <th className="text-right">{t("customers.col.points")}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.members.map((m) => (
                    <tr key={m.userKey}>
                      <td>
                        <Link
                          to="/admin/customers/$key"
                          params={{ key: m.userKey }}
                          className="hover:text-accent"
                        >
                          {m.name || "—"}
                        </Link>{" "}
                        {m.username && <span className="text-muted">@{m.username}</span>}
                        {m.optOut && <Badge tone="warn">{t("seg.optOut")}</Badge>}
                      </td>
                      <td className="text-muted">{m.platform}</td>
                      <td className="text-right tabular-nums">{m.orders}</td>
                      <td className="text-muted">
                        {m.lastAt ? new Date(m.lastAt).toLocaleDateString(loc) : "—"}
                      </td>
                      <td className="text-right tabular-nums">{m.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
