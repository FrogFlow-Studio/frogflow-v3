import { useEffect, useState } from "react";
import { addrT } from "@/app/i18n/storefront-addr";
import { ADDRESSES_MAX, ADDRESS_MAX_CHARS, type SavedAddress } from "@/core/storefront/addresses";
import { webAddressDeleteFn, webAddressSaveFn, webMyAddressesFn } from "./tg-login.functions";
import { useStorefrontLocale } from "./locale";

type Reason = "full" | "unknown" | "bad_text";

/** Сохранённые адреса вошедшего покупателя (К5): загрузка списка; не вошёл или ошибка — null. */
export function useSavedAddresses(slug: string, enabled: boolean) {
  const [items, setItems] = useState<SavedAddress[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    webMyAddressesFn({ data: { slug } }).then(
      (r) => alive && setItems(r.items),
      () => alive && setItems(null),
    );
    return () => {
      alive = false;
    };
  }, [slug, enabled]);
  return { items, setItems };
}

/** «Мои адреса» в «Мои заказы»: добавить, изменить, удалить; не больше пяти. */
export function MyAddressesBox({ slug }: { slug: string }) {
  const { locale } = useStorefrontLocale();
  const t = addrT(locale);
  const { items, setItems } = useSavedAddresses(slug, true);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (items === null) return null;
  const say = (r: Reason | "failed") =>
    setNote(
      r === "full"
        ? t("addr.full", { n: ADDRESSES_MAX })
        : r === "bad_text"
          ? t("addr.bad", { n: ADDRESS_MAX_CHARS })
          : t("addr.failed"),
    );
  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await webAddressSaveFn({
        data: { slug, text, ...(editing && editing !== "new" ? { id: editing } : {}) },
      });
      if (r.ok) {
        setItems(r.items);
        setEditing(null);
        setText("");
      } else say(r.reason === "no_card" ? "failed" : r.reason);
    } catch {
      say("failed");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    setBusy(true);
    setNote(null);
    try {
      const r = await webAddressDeleteFn({ data: { slug, id } });
      if (r.ok) setItems(r.items);
      else say(r.reason === "no_card" ? "failed" : r.reason);
    } catch {
      say("failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="space-y-2 rounded-md border border-line p-3 text-sm"
      data-testid="my-addresses"
    >
      <h2 className="font-semibold">{t("addr.title")}</h2>
      <p className="text-xs text-muted">{t("addr.hint")}</p>
      {items.length === 0 && editing !== "new" && <p className="text-muted">{t("addr.empty")}</p>}
      <ul className="space-y-2">
        {items.map((a) => (
          <li key={a.id} className="flex flex-wrap items-start justify-between gap-2">
            {editing === a.id ? null : <span className="min-w-0 break-words">{a.text}</span>}
            {editing === a.id ? null : (
              <span className="flex gap-2 text-xs">
                <button
                  type="button"
                  className="underline"
                  disabled={busy}
                  onClick={() => {
                    setEditing(a.id);
                    setText(a.text);
                    setNote(null);
                  }}
                >
                  {t("addr.edit")}
                </button>
                <button
                  type="button"
                  className="underline"
                  disabled={busy}
                  onClick={() => void remove(a.id)}
                >
                  {t("addr.delete")}
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {editing !== null ? (
        <div className="space-y-2">
          <textarea
            className="input w-full"
            rows={2}
            maxLength={ADDRESS_MAX_CHARS}
            placeholder={t("addr.placeholder")}
            aria-label={t("addr.placeholder")}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex gap-2">
            <button type="button" className="btn" disabled={busy} onClick={() => void save()}>
              {t("addr.save")}
            </button>
            <button
              type="button"
              className="underline text-xs"
              onClick={() => {
                setEditing(null);
                setText("");
                setNote(null);
              }}
            >
              {t("addr.cancel")}
            </button>
          </div>
        </div>
      ) : (
        items.length < ADDRESSES_MAX && (
          <button
            type="button"
            className="underline text-xs"
            onClick={() => {
              setEditing("new");
              setText("");
              setNote(null);
            }}
          >
            {t("addr.add")}
          </button>
        )
      )}
      {note && (
        <p role="status" className="text-xs text-muted">
          {note}
        </p>
      )}
    </section>
  );
}
