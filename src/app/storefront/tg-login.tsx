import { useEffect, useRef, useState } from "react";
import { tgLoginFn, tgLoginStateFn, tgLogoutFn } from "./tg-login.functions";
import { codeLoginFn, codeLoginStartFn } from "./code-login.functions";
import { useTelegramWebApp } from "./cart";
import { useStorefrontLocale } from "./locale";
import { ErrorBox } from "@/app/ui";

type LoginState = Awaited<ReturnType<typeof tgLoginStateFn>>;

/**
 * Состояние входа через Telegram на витрине. Внутри Telegram (Mini App)
 * покупатель входит сам — по той же initData, что и «Мои заказы».
 */
export function useTgLogin(slug: string) {
  const wa = useTelegramWebApp();
  const [state, setState] = useState<LoginState | null>(null);
  const [error, setError] = useState<unknown>(null);
  const tried = useRef(false);

  useEffect(() => {
    tgLoginStateFn({ data: { slug } }).then(setState, () =>
      setState({ available: false, bot: null, me: null, points: false }),
    );
  }, [slug]);

  const login = async (payload: { widget: Record<string, string> } | { initData: string }) => {
    setError(null);
    try {
      const r = await tgLoginFn({ data: { slug, ...payload } });
      setState((s) => (s?.available ? { ...s, me: { name: r.name } } : s));
    } catch (e) {
      setError(e);
    }
  };

  useEffect(() => {
    if (!wa || !state?.available || state.me || tried.current) return;
    tried.current = true;
    void login({ initData: wa.initData });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wa, state]);

  const loginWithCode = async (code: string) => {
    setError(null);
    try {
      const r = await codeLoginFn({ data: { slug, code } });
      setState((s) => (s?.available ? { ...s, me: { name: r.name } } : s));
      return true;
    } catch (e) {
      setError(e);
      return false;
    }
  };

  const logout = async () => {
    await tgLogoutFn({ data: { slug } }).catch(() => {});
    setState((s) => (s?.available ? { ...s, me: null } : s));
  };

  return { state, error, login, loginWithCode, logout, inTelegram: Boolean(wa), slug };
}

/** Поля пользователя из виджета → строки, как их подписал Telegram. */
function widgetFields(user: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(user)) if (v !== undefined && v !== null) out[k] = String(v);
  return out;
}

/** Кнопка виджета Telegram от бота магазина. */
function TelegramWidget({
  bot,
  onAuth,
}: {
  bot: string;
  onAuth: (fields: Record<string, string>) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const cb = useRef(onAuth);
  cb.current = onAuth;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const w = window as unknown as Record<string, unknown>;
    w.__ffTgAuth = (user: Record<string, unknown>) => cb.current(widgetFields(user));
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://telegram.org/js/telegram-widget.js?22";
    s.setAttribute("data-telegram-login", bot);
    s.setAttribute("data-size", "medium");
    s.setAttribute("data-radius", "8");
    s.setAttribute("data-onauth", "__ffTgAuth(user)");
    el.replaceChildren(s);
    return () => el.replaceChildren();
  }, [bot]);
  return <div ref={box} className="min-h-10" />;
}

/**
 * Вход по коду (В5): ссылка в бот магазина с меткой браузера, код приходит в чат,
 * покупатель вводит его здесь. Для тех, у кого не работает виджет Telegram, и для
 * покупателей Instagram/WhatsApp (сообщение «вход …» магазину).
 */
function CodeLogin({ login: l }: { login: ReturnType<typeof useTgLogin> }) {
  const { t } = useStorefrontLocale();
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState<Awaited<ReturnType<typeof codeLoginStartFn>> | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<unknown>(null);
  const start = async () => {
    setStartError(null);
    try {
      setLinks(await codeLoginStartFn({ data: { slug: l.slug } }));
      setOpen(true);
    } catch (e) {
      setStartError(e);
    }
  };
  if (!open)
    return (
      <div className="space-y-1">
        <ErrorBox error={startError} />
        <button
          type="button"
          className="text-sm text-accent hover:underline"
          onClick={() => void start()}
        >
          {t("login.code.button")}
        </button>
      </div>
    );
  return (
    <form
      className="space-y-2 rounded-lg border border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void l.loginWithCode(code.trim()).finally(() => setBusy(false));
      }}
    >
      {links?.botLink && (
        <a
          href={links.botLink}
          target="_blank"
          rel="noreferrer"
          className="inline-block rounded-lg bg-accent px-3 py-2 text-sm text-white"
        >
          {t("login.code.open")}
        </a>
      )}
      {links?.directText && (
        <p className="text-xs text-muted">
          {t("login.code.direct")} <code className="select-all">{links.directText}</code>
        </p>
      )}
      <label className="block text-sm">
        {t("login.code.enter")}
        <input
          name="login-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          pattern="\d{6}"
          className="mt-1 block w-40 rounded-lg border border-line px-3 py-2"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        />
      </label>
      <ErrorBox error={l.error} />
      <button
        type="submit"
        disabled={busy || code.length !== 6}
        className="rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-50"
      >
        {t("login.code.submit")}
      </button>
      <p className="text-xs text-muted">{t("login.code.hint")}</p>
    </form>
  );
}

/** Блок входа: кнопка Telegram или «Вы вошли: …» с выходом. Нет входа у магазина — ничего. */
export function TgLoginBox({
  login: l,
  hint = true,
}: {
  login: ReturnType<typeof useTgLogin>;
  hint?: boolean;
}) {
  const { t } = useStorefrontLocale();
  const s = l.state;
  if (!s?.available) return null;
  if (s.me)
    return (
      <p className="text-sm text-muted">
        {t("login.as", { name: s.me.name })}{" "}
        {!l.inTelegram && (
          <button
            type="button"
            className="text-accent hover:underline"
            onClick={() => void l.logout()}
          >
            {t("login.logout")}
          </button>
        )}
      </p>
    );
  if (l.inTelegram || !s.bot) return <ErrorBox error={l.error} />;
  return (
    <div className="space-y-1">
      <ErrorBox error={l.error} />
      <TelegramWidget bot={s.bot} onAuth={(widget) => void l.login({ widget })} />
      <CodeLogin login={l} />
      {hint && (
        <p className="text-xs text-muted">{t(s.points ? "login.pointsHint" : "login.hint")}</p>
      )}
    </div>
  );
}
