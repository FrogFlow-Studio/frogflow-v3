import { useEffect, useState } from "react";
import { ErrorBox } from "@/app/ui";
import { intlLocale } from "@/app/i18n/admin";
import type { MyTickets } from "@/core/helpdesk/mine";
import { useStorefrontLocale } from "./locale";

/**
 * «Поддержка» в Mini App под списком заказов: номер, статус и тема своих
 * обращений и поле «дописать» для открытого. Данные — по initData Mini App
 * (родительская страница показывает блок только внутри Telegram); обращений
 * нет — блока нет.
 */
export function MyTicketsBox({
  load,
  append,
}: {
  load: () => Promise<MyTickets>;
  append: (text: string) => Promise<unknown>;
}) {
  const { t, locale } = useStorefrontLocale();
  const [data, setData] = useState<MyTickets | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const reload = () => load().then(setData, setError);
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (error) return <ErrorBox error={error} />;
  if (!data || data.tickets.length === 0) return null;
  const send = () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    append(text.trim())
      .then(() => {
        setText("");
        setSent(true);
        return reload();
      }, setError)
      .finally(() => setBusy(false));
  };
  return (
    <section className="space-y-3 rounded-md border border-line p-3 text-sm">
      <h2 className="font-semibold">{t("tickets.title")}</h2>
      <ul className="divide-y divide-line">
        {data.tickets.map((tk) => (
          <li key={tk.number} className="py-2">
            <div className="flex items-center justify-between">
              <span className="font-medium">#{tk.number}</span>
              <span className="text-xs text-muted">
                {t(`tickets.status.${tk.status}` as never)} ·{" "}
                {new Date(tk.updatedAt).toLocaleDateString(intlLocale(locale))}
              </span>
            </div>
            <p className="line-clamp-2 break-words text-muted">{tk.subject}</p>
          </li>
        ))}
      </ul>
      {data.more > 0 && <p className="text-xs text-muted">{t("tickets.more", { n: data.more })}</p>}
      {data.canAppend && (
        <div className="space-y-2">
          <textarea
            className="input min-h-20 w-full"
            maxLength={1000}
            placeholder={t("tickets.appendPlaceholder")}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSent(false);
            }}
          />
          <button
            type="button"
            className="btn-secondary"
            disabled={!text.trim() || busy}
            onClick={send}
          >
            {t("tickets.append")}
          </button>
          {sent && <p className="text-xs text-muted">{t("tickets.sent")}</p>}
        </div>
      )}
    </section>
  );
}
