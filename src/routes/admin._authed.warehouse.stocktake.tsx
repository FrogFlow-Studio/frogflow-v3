import { HelpTip } from "@/app/admin/help-panel";
import { canEdit } from "@/core/auth/roles";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import {
  stocktakeCancelFn,
  stocktakeConfirmFn,
  stocktakeCountFn,
  stocktakeFn,
  stocktakeStartFn,
} from "@/app/admin/warehouse.functions";
import { adminT, intlLocale } from "@/app/i18n/admin";
import { Badge, Card, ErrorBox, PageTitle, useAction } from "@/app/ui";

export const Route = createFileRoute("/admin/_authed/warehouse/stocktake")({
  beforeLoad: ({ context }) => {
    if (!context.shop.modules.warehouse) throw redirect({ to: "/admin" });
  },
  loader: () => stocktakeFn({ data: { page: 0, q: "" } }),
  component: StocktakePage,
});

type Data = Awaited<ReturnType<typeof stocktakeFn>>;
type Item = Data["items"][number];

function StocktakePage() {
  const first = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const canWrite = canEdit(shop.role);
  const [data, setData] = useState<Data>(first);
  const [items, setItems] = useState<Item[]>(first.items);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  /** Что введено, но ещё не сохранено: id товара → текст поля. */
  const [typed, setTyped] = useState<Record<string, string>>({});
  const session = data.session;
  const open = session && session.status !== "posted";

  const reload = async (q = query) => {
    const r = await stocktakeFn({ data: { page: 0, q } });
    setData(r);
    setItems(r.items);
    setPage(0);
    setTyped({});
  };
  /** Только сессия и расхождения — введённые, но не сохранённые числа остаются на месте. */
  const refreshMeta = async () => {
    const r = await stocktakeFn({ data: { page: 0, q: query } });
    setData((d) => ({ ...d, session: r.session, diffs: r.diffs }));
  };
  const act = useAction(async (fn: () => Promise<unknown>) => {
    setNotice(null);
    try {
      await fn();
    } finally {
      await reload().catch(() => {});
    }
  });
  const run = (fn: () => Promise<unknown>) => void act.run(fn).catch(() => {});
  const save = useAction(async (item: Item, raw: string) => {
    if (!session) return;
    const text = raw.trim();
    const counted = text === "" ? null : Number(text);
    if (counted !== null && (!Number.isInteger(counted) || counted < 0)) return;
    if ((item.counted ?? null) === counted) return;
    await stocktakeCountFn({ data: { id: session.id, productId: item.id, counted } });
    setItems((cur) =>
      cur.map((i) =>
        i.id === item.id ? { ...i, counted, expected: counted === null ? null : i.stock } : i,
      ),
    );
    await refreshMeta();
  });
  const more = useAction(async () => {
    const r = await stocktakeFn({ data: { page: page + 1, q: query } });
    setItems((cur) => [...cur, ...r.items.filter((i) => !cur.some((c) => c.id === i.id))]);
    setPage(page + 1);
  });
  const when = (iso: string) =>
    new Date(iso).toLocaleDateString(intlLocale(shop.locale), { dateStyle: "short" });

  return (
    <>
      <PageTitle
        title={t("stocktake.title")}
        subtitle={t("stocktake.subtitle")}
        actions={
          <Link to="/admin/warehouse" className="btn-ghost">
            {t("warehouse.back")}
          </Link>
        }
      />
      <div className="space-y-3">
        <ErrorBox error={act.error ?? save.error ?? more.error} />
        {notice && <p className="text-sm text-ok">{notice}</p>}
        {!open && (
          <Card>
            <p className="text-sm text-muted">
              {session?.postedAt
                ? t("stocktake.lastDone", { when: when(session.postedAt) })
                : t("stocktake.none")}
            </p>
            {canWrite && (
              <button
                className="btn-primary mt-3"
                disabled={act.busy}
                onClick={() => run(() => stocktakeStartFn())}
              >
                {t("stocktake.start")}
              </button>
            )}
          </Card>
        )}
        {open && session && (
          <>
            {session.status !== "draft" && (
              <p className="text-sm text-warn">{t("stocktake.partial")}</p>
            )}
            <Card
              title={t("stocktake.diffs")}
              help={<HelpTip article="warehouse" anchor="stocktake" />}
              actions={<Badge>{t("stocktake.entered", { n: session.entered })}</Badge>}
            >
              {data.diffs.length === 0 ? (
                <p className="text-sm text-muted">{t("stocktake.diffsNone")}</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {data.diffs.map((d) => (
                    <li key={d.productId}>
                      {t("stocktake.diffRow", {
                        name: d.name,
                        expected: d.expected,
                        counted: d.counted,
                      })}{" "}
                      <span className={d.diff > 0 ? "text-ok" : "text-danger"}>
                        ({d.diff > 0 ? "+" : ""}
                        {d.diff})
                      </span>
                      {d.stock !== null && d.stock !== d.expected && (
                        <span className="ml-1 text-xs text-muted">
                          · {t("stocktake.diffNow", { n: d.stock })}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canWrite && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="btn-primary"
                    disabled={act.busy || data.diffs.length === 0}
                    onClick={() => {
                      if (!confirm(t("stocktake.confirmAsk", { n: data.diffs.length }))) return;
                      run(async () => {
                        const r = await stocktakeConfirmFn({ data: { id: session.id } });
                        setNotice(
                          r.changed > 0
                            ? t("stocktake.done", { n: r.changed })
                            : t("stocktake.nothing"),
                        );
                      });
                    }}
                  >
                    {t("stocktake.confirm")}
                  </button>
                  {session.status === "draft" && (
                    <button
                      className="btn-ghost"
                      disabled={act.busy}
                      onClick={() => {
                        if (confirm(t("stocktake.cancelAsk")))
                          run(() => stocktakeCancelFn({ data: { id: session.id } }));
                      }}
                    >
                      {t("stocktake.cancel")}
                    </button>
                  )}
                </div>
              )}
            </Card>
            <Card>
              <form
                className="mb-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void reload(query).catch(() => {});
                }}
              >
                <input
                  className="input"
                  type="search"
                  value={query}
                  placeholder={t("stocktake.search")}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </form>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t("stocktake.col.product")}</th>
                      <th>{t("stocktake.col.stock")}</th>
                      <th>{t("stocktake.col.counted")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.id}>
                        <td>{i.name}</td>
                        <td className="tabular-nums">{i.stock}</td>
                        <td>
                          <input
                            className="input w-24"
                            type="number"
                            min={0}
                            step={1}
                            aria-label={`${t("stocktake.col.counted")}: ${i.name}`}
                            disabled={!canWrite || session.status !== "draft"}
                            value={typed[i.id] ?? (i.counted === null ? "" : String(i.counted))}
                            onChange={(e) => setTyped({ ...typed, [i.id]: e.target.value })}
                            onBlur={(e) => {
                              void save.run(i, e.target.value).catch(() => {});
                              setTyped(({ [i.id]: _, ...rest }) => rest);
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {items.length < data.total && (
                <button
                  className="btn-ghost mt-2 text-sm"
                  disabled={more.busy}
                  onClick={() => void more.run().catch(() => {})}
                >
                  {t("stocktake.more")}
                </button>
              )}
            </Card>
          </>
        )}
      </div>
    </>
  );
}
