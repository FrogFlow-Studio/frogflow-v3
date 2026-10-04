import { canEdit } from "@/core/auth/roles";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  createRequestFn,
  deleteRequestFn,
  orderRequestFn,
  receiveRequestFn,
  requestExportFn,
  requestsFn,
  updateRequestFn,
} from "@/app/admin/stock-requests.functions";
import { adminT, type AdminT } from "@/app/i18n/admin";
import { Badge, Card, ErrorBox, PageTitle, useAction } from "@/app/ui";

export const Route = createFileRoute("/admin/_authed/warehouse/requests")({
  beforeLoad: ({ context }) => {
    if (!context.shop.modules.warehouse) throw redirect({ to: "/admin" });
  },
  loader: () => requestsFn(),
  component: RequestsPage,
});

type Data = Awaited<ReturnType<typeof requestsFn>>;
type Req = Data["requests"][number];
type Group = Data["suggestions"][number];

function RequestsPage() {
  const data = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const canWrite = canEdit(shop.role);
  const router = useRouter();
  const act = useAction(async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } finally {
      await router.invalidate();
    }
  });
  const run = (fn: () => Promise<unknown>) => void act.run(fn).catch(() => {});
  const supplierName = (id: string | null) =>
    id === null
      ? t("requests.noSupplier")
      : (data.suppliers.find((s) => s.id === id)?.name ?? t("requests.supplierGone"));
  return (
    <>
      <PageTitle
        title={t("requests.title")}
        subtitle={t("requests.subtitle")}
        actions={
          <Link to="/admin/warehouse" className="btn-ghost">
            {t("warehouse.back")}
          </Link>
        }
      />
      <ErrorBox error={act.error} />
      <h2 className="mb-2 mt-2 text-sm font-medium">{t("requests.suggested")}</h2>
      {data.suggestions.length === 0 ? (
        <p className="mb-4 text-sm text-muted">{t("requests.suggestedEmpty")}</p>
      ) : (
        <div className="mb-6 space-y-3">
          {data.suggestions.map((g) => (
            <SuggestCard
              key={g.supplierId ?? "none"}
              group={g}
              title={supplierName(g.supplierId)}
              t={t}
              canWrite={canWrite}
              busy={act.busy}
              onCreate={(lines) =>
                run(() => createRequestFn({ data: { supplierId: g.supplierId, lines } }))
              }
            />
          ))}
        </div>
      )}
      <h2 className="mb-2 text-sm font-medium">{t("requests.list")}</h2>
      {data.requests.length === 0 ? (
        <p className="text-sm text-muted">{t("requests.empty")}</p>
      ) : (
        <div className="space-y-3">
          {data.requests.map((r) => (
            <RequestCard
              key={`${r.id}:${r.status}:${r.lines.map((l) => l.qty).join(",")}`}
              req={r}
              title={supplierName(r.supplierId)}
              t={t}
              canWrite={canWrite}
              busy={act.busy}
              run={run}
            />
          ))}
        </div>
      )}
    </>
  );
}

function SuggestCard(props: {
  group: Group;
  title: string;
  t: AdminT;
  canWrite: boolean;
  busy: boolean;
  onCreate: (lines: Array<{ productId: string; qty: number }>) => void;
}) {
  const { group, t } = props;
  const [qty, setQty] = useState<Record<string, string>>(
    Object.fromEntries(group.lines.map((l) => [l.productId, String(l.qty)])),
  );
  const [off, setOff] = useState<Set<string>>(new Set());
  const chosen = group.lines
    .filter((l) => !off.has(l.productId))
    .map((l) => ({ productId: l.productId, qty: Number(qty[l.productId]) }));
  const valid = chosen.length > 0 && chosen.every((l) => Number.isInteger(l.qty) && l.qty >= 1);
  return (
    <Card title={props.title}>
      <table className="table">
        <thead>
          <tr>
            <th className="w-8"></th>
            <th>{t("requests.col.name")}</th>
            <th className="text-right">{t("requests.col.stock")}</th>
            <th>{t("requests.col.why")}</th>
            <th className="text-right">{t("requests.col.qty")}</th>
          </tr>
        </thead>
        <tbody>
          {group.lines.map((l) => (
            <tr key={l.productId}>
              <td>
                <input
                  type="checkbox"
                  aria-label={t("requests.pick", { name: l.name })}
                  checked={!off.has(l.productId)}
                  onChange={(e) =>
                    setOff((o) => {
                      const n = new Set(o);
                      if (e.target.checked) n.delete(l.productId);
                      else n.add(l.productId);
                      return n;
                    })
                  }
                />
              </td>
              <td>{l.name}</td>
              <td className="text-right tabular-nums">{l.stock}</td>
              <td className="text-xs text-muted">
                {t(`requests.why.${l.reason}`)}
                {l.days !== null && l.days < 7 ? ` · ${t("requests.daysLeft", { n: l.days })}` : ""}
              </td>
              <td className="text-right">
                <input
                  className="input w-24 text-right"
                  type="number"
                  min={1}
                  aria-label={t("requests.qtyOf", { name: l.name })}
                  value={qty[l.productId] ?? ""}
                  onChange={(e) => setQty((q) => ({ ...q, [l.productId]: e.target.value }))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {props.canWrite && (
        <div className="mt-3">
          <button
            className="btn-primary"
            disabled={props.busy || !valid}
            onClick={() => props.onCreate(chosen)}
          >
            {t("requests.create")}
          </button>
        </div>
      )}
    </Card>
  );
}

function RequestCard(props: {
  req: Req;
  title: string;
  t: AdminT;
  canWrite: boolean;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => void;
}) {
  const { req, t } = props;
  const [qty, setQty] = useState<Record<string, string>>(
    Object.fromEntries(req.lines.map((l) => [l.productId, String(l.qty)])),
  );
  const [note, setNote] = useState<string | null>(null);
  const draft = req.status === "draft";
  const changed = req.lines.some((l) => Number(qty[l.productId]) !== l.qty);
  const valid = req.lines.every((l) => {
    const n = Number(qty[l.productId]);
    return Number.isInteger(n) && n >= 1;
  });
  const exportRequest = async () => requestExportFn({ data: { id: req.id } });
  return (
    <Card
      title={t("requests.cardTitle", { no: req.no, supplier: props.title })}
      actions={
        <Badge tone={req.status === "received" ? "ok" : undefined}>
          {t(`requests.status.${req.status}`)}
        </Badge>
      }
    >
      <table className="table">
        <thead>
          <tr>
            <th>{t("requests.col.name")}</th>
            <th className="text-right">{t("requests.col.qty")}</th>
          </tr>
        </thead>
        <tbody>
          {req.lines.map((l) => (
            <tr key={l.productId}>
              <td>{l.name}</td>
              <td className="text-right">
                {draft && props.canWrite ? (
                  <input
                    className="input w-24 text-right"
                    type="number"
                    min={1}
                    aria-label={t("requests.qtyOf", { name: l.name })}
                    value={qty[l.productId] ?? ""}
                    onChange={(e) => setQty((q) => ({ ...q, [l.productId]: e.target.value }))}
                  />
                ) : (
                  <span className="tabular-nums">{l.qty}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className="btn-secondary"
          onClick={() =>
            props.run(async () => {
              const r = await exportRequest();
              await navigator.clipboard.writeText(r.text);
              setNote(t("requests.copied"));
            })
          }
        >
          {t("requests.copy")}
        </button>
        <button
          className="btn-secondary"
          onClick={() =>
            props.run(async () => {
              const r = await exportRequest();
              const url = URL.createObjectURL(
                new Blob([r.csv], { type: "text/csv;charset=utf-8" }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = `zayavka-${r.no}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            })
          }
        >
          {t("requests.csv")}
        </button>
        {props.canWrite && draft && (
          <>
            {changed && (
              <button
                className="btn-secondary"
                disabled={props.busy || !valid}
                onClick={() =>
                  props.run(() =>
                    updateRequestFn({
                      data: {
                        id: req.id,
                        supplierId: req.supplierId,
                        lines: req.lines.map((l) => ({
                          productId: l.productId,
                          qty: Number(qty[l.productId]),
                        })),
                      },
                    }),
                  )
                }
              >
                {t("requests.saveQty")}
              </button>
            )}
            <button
              className="btn-primary"
              disabled={props.busy || changed}
              onClick={() => props.run(() => orderRequestFn({ data: { id: req.id } }))}
            >
              {t("requests.markOrdered")}
            </button>
            <button
              className="btn-ghost"
              disabled={props.busy}
              onClick={() => {
                if (confirm(t("requests.deleteConfirm", { no: req.no })))
                  props.run(() => deleteRequestFn({ data: { id: req.id } }));
              }}
            >
              {t("requests.delete")}
            </button>
          </>
        )}
        {props.canWrite && req.status === "ordered" && (
          <button
            className="btn-primary"
            disabled={props.busy}
            onClick={() =>
              props.run(async () => {
                const r = await receiveRequestFn({ data: { id: req.id } });
                setNote(t("requests.receiptCreated", { no: r.no }));
              })
            }
          >
            {t("requests.receive")}
          </button>
        )}
      </div>
      {note && <p className="mt-2 text-sm text-muted">{note}</p>}
      {req.status === "ordered" && (
        <p className="mt-2 text-xs text-muted">{t("requests.orderedHint")}</p>
      )}
    </Card>
  );
}
