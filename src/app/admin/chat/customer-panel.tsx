import { Link } from "@tanstack/react-router";
import { formatMoney } from "@/core/money/money";
import { OrderStatus } from "@/routes/admin._authed.orders";
import { useEffect, useState } from "react";
import { chatCustomerPanelFn } from "@/app/admin/chat.functions";
import { saveCustomerNoteFn } from "@/app/admin/customers.functions";
import { type AdminT } from "@/app/i18n/admin";
import { ErrorBox, useAction } from "@/app/ui";

type PanelData = Awaited<ReturnType<typeof chatCustomerPanelFn>>;

/**
 * Боковая панель диалога: что продавцу нужно знать о покупателе, пока он отвечает.
 * Без контактов; ссылка на карточку (в ней телефон и почта) — только ролям с доступом к контактам.
 * На узком экране панель — полоса над перепиской.
 */
export function CustomerPanelView({
  t,
  loc,
  telegramId,
  canOpenCard,
  canWrite,
  sells = true,
}: {
  t: AdminT;
  loc: string;
  telegramId: number;
  canOpenCard: boolean;
  canWrite: boolean;
  /** Консультант без продаж: без баллов, суммы покупок и заказов. */
  sells?: boolean;
}) {
  const [data, setData] = useState<PanelData | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      chatCustomerPanelFn({ data: { telegramId } }).then(
        (r) => {
          if (alive) {
            setData(r);
            setFailed(false);
          }
        },
        () => alive && setFailed(true),
      );
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [telegramId]);
  // Теги и заметка: правка на месте, запись по версии (та же функция, что в карточке покупателя).
  const [tags, setTags] = useState("");
  const [note, setNote] = useState("");
  const [version, setVersion] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [noteConflict, setNoteConflict] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  // Опрос панели не затирает то, что продавец печатает: чужая правка подтянется, пока он не начал.
  useEffect(() => {
    if (!data || dirty) return;
    // Ответ опроса, ушедший до нашей записи, старее того, что уже на экране: не откатываем.
    if (version && (!data.sellerVersion || Date.parse(data.sellerVersion) < Date.parse(version)))
      return;
    setTags(data.seller.tags.join(", "));
    setNote(data.seller.note);
    setVersion(data.sellerVersion);
  }, [data, dirty, version]);
  const saveNote = useAction(async () => {
    if (!data) return;
    setNoteSaved(false);
    setNoteConflict(false);
    const r = await saveCustomerNoteFn({
      data: { key: data.userKey, tags: tags.split(",").map((x) => x.trim()), note, version },
    });
    setVersion(r.version);
    setTags(r.note.tags.join(", "));
    setNote(r.note.note);
    setData((d) => (d ? { ...d, seller: r.note, sellerVersion: r.version } : d));
    setDirty(false);
    if (r.saved) setNoteSaved(true);
    else setNoteConflict(true);
  });
  const spent = data
    ? Object.entries(data.stats.totals)
        .map(([cur, sum]) => formatMoney(sum, cur))
        .join(" + ")
    : "";
  return (
    <aside
      aria-label={t("chat.panelTitle")}
      className="max-h-40 shrink-0 overflow-y-auto border-b border-line p-3 text-sm lg:max-h-none lg:w-64 lg:border-b-0 lg:border-l lg:order-last"
    >
      <p className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">
        {t("chat.panelTitle")}
      </p>
      {failed && !data ? (
        <p className="text-xs text-muted">{t("chat.panelNone")}</p>
      ) : data === undefined ? null : data === null ? (
        <p className="text-xs text-muted">{t("chat.panelNone")}</p>
      ) : (
        <div className="space-y-3">
          {sells && (
            <dl className="space-y-1">
              <div className="flex justify-between gap-2">
                <dt className="text-muted">{t("chat.panelPoints")}</dt>
                <dd className="tabular-nums">{data.points}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted">{t("chat.panelSpent")}</dt>
                <dd className="text-right tabular-nums">{spent || "—"}</dd>
              </div>
            </dl>
          )}
          {sells && (
            <div>
              <p className="mb-1 text-xs text-muted">{t("chat.panelOrders")}</p>
              {data.orders.length === 0 ? (
                <p className="text-xs text-muted">{t("chat.panelNoOrders")}</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.orders.map((o) => (
                    <li key={o.id}>
                      <Link
                        to="/admin/orders/$id"
                        params={{ id: String(o.id) }}
                        className="flex flex-wrap items-center justify-between gap-x-2 hover:text-accent"
                      >
                        <span>#{o.no}</span>
                        <span className="tabular-nums">{formatMoney(o.total, o.currency)}</span>
                        <span className="w-full text-xs text-muted">
                          <OrderStatus status={o.status} /> ·{" "}
                          {new Date(o.createdAt).toLocaleDateString(loc)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {data.tickets.length > 0 && (
            <div>
              <p className="mb-1 text-xs text-muted">{t("chat.panelTickets")}</p>
              <ul className="space-y-1">
                {data.tickets.map((x) => (
                  <li key={x.number}>
                    <Link to="/admin/tickets" className="block truncate hover:text-accent">
                      #{x.number} {x.subject}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="mb-1 text-xs text-muted">{t("customer.sellerTitle")}</p>
            <ErrorBox error={saveNote.error} />
            {noteConflict && <p className="mb-1 text-xs text-warn">{t("customer.noteConflict")}</p>}
            <input
              className="input mb-1 w-full text-xs"
              aria-label={t("customer.tags")}
              placeholder={t("customer.tags")}
              value={tags}
              disabled={!canWrite}
              onChange={(e) => {
                setTags(e.target.value);
                setDirty(true);
                setNoteSaved(false);
              }}
            />
            <textarea
              className="input min-h-16 w-full text-xs"
              aria-label={t("customer.note")}
              placeholder={t("customer.note")}
              value={note}
              maxLength={2000}
              disabled={!canWrite}
              onChange={(e) => {
                setNote(e.target.value);
                setDirty(true);
                setNoteSaved(false);
              }}
            />
            {canWrite && (
              <div className="mt-1 flex items-center justify-end gap-2">
                {noteSaved && <span className="text-xs text-muted">{t("customer.saved")}</span>}
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  disabled={saveNote.busy || !dirty}
                  onClick={() => void saveNote.run().catch(() => {})}
                >
                  {t("customer.save")}
                </button>
              </div>
            )}
          </div>
          {canOpenCard && (
            <Link
              to="/admin/customers/$key"
              params={{ key: data.userKey }}
              className="btn-secondary block text-center text-xs"
            >
              {t("chat.panelCard")}
            </Link>
          )}
        </div>
      )}
    </aside>
  );
}
