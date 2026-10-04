import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { sendSupportMessageFn, supportFn, supportReadFn } from "@/app/admin/support.functions";
import { adminT, intlLocale } from "@/app/i18n/admin";
import { Badge, Card, Empty, ErrorBox, PageTitle, useAction } from "@/app/ui";
import { canEdit } from "@/core/auth/roles";
import { suggestHelp } from "@/core/help/articles";
import { SUPPORT_BODY_MAX, type ThreadStatus } from "@/core/support/support";

export const Route = createFileRoute("/admin/_authed/support")({
  loader: () => supportFn(),
  component: SupportPage,
});

const TONE: Record<ThreadStatus, "accent" | "warn" | "ok" | "neutral"> = {
  new: "accent",
  in_progress: "accent",
  waiting_seller: "warn",
  resolved: "ok",
};

/** Чат с поддержкой платформы: ответы оператора приходят сюда же. */
function SupportPage() {
  const view = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const router = useRouter();
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const writable = canEdit(shop.role);
  const suggestions = suggestHelp(text, shop.locale);
  const unread = view.available ? view.unread : 0;

  // Открыли чат — ответы прочитаны; новые ответы подтягиваем раз в полминуты.
  useEffect(() => {
    if (unread > 0) void supportReadFn().catch(() => {});
  }, [unread]);
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void router.invalidate();
    }, 30_000);
    return () => clearInterval(id);
  }, [router]);
  const count = view.available ? view.messages.length : 0;
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [count]);

  const send = useAction(async () => {
    await sendSupportMessageFn({ data: { body: text } });
    setText("");
    await router.invalidate();
  });

  if (!view.available)
    return (
      <>
        <PageTitle title={t("support.title")} subtitle={t("support.subtitle")} />
        <Card>
          <Empty>
            <p className="font-medium">{t("support.soon.title")}</p>
            <p className="mt-1">{t("support.soon.text")}</p>
          </Empty>
        </Card>
      </>
    );

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(intlLocale(shop.locale), {
      dateStyle: "short",
      timeStyle: "short",
    });
  return (
    <>
      <PageTitle title={t("support.title")} subtitle={t("support.subtitle")} />
      <div className="mb-3 flex items-center gap-3">
        {view.status && (
          <Badge tone={TONE[view.status]}>
            {t("support.status", { status: t(`support.status.${view.status}`) })}
          </Badge>
        )}
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={() => void router.invalidate()}
        >
          {t("support.refresh")}
        </button>
      </div>
      <Card>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto p-4" aria-label={t("support.title")}>
          {view.messages.length === 0 ? (
            <Empty>{t("support.empty")}</Empty>
          ) : (
            view.messages.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col ${m.author === "seller" ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                    m.author === "seller" ? "bg-accent/10" : "bg-surface-2 border border-line"
                  }`}
                >
                  {m.body}
                </div>
                <span className="mt-0.5 text-xs text-muted">
                  {m.author === "seller" ? (m.authorName ?? t("support.you")) : t("support.team")}
                  {" · "}
                  {fmt(m.createdAt)}
                </span>
              </div>
            ))
          )}
          <div ref={end} />
        </div>
        <div className="border-t border-line p-4">
          {writable ? (
            <>
              <ErrorBox error={send.error} />
              <textarea
                className="input w-full"
                rows={3}
                maxLength={SUPPORT_BODY_MAX}
                value={text}
                placeholder={t("support.placeholder")}
                aria-label={t("support.placeholder")}
                onChange={(e) => setText(e.target.value)}
              />
              {suggestions.length > 0 && (
                <p className="mt-2 text-sm">
                  {t("help.maybe")}{" "}
                  {suggestions.map((x, i) => (
                    <span key={x.slug}>
                      {i > 0 && ", "}
                      <Link
                        to="/admin/help"
                        search={{ a: x.slug }}
                        target="_blank"
                        className="text-accent underline"
                      >
                        {x.title}
                      </Link>
                    </span>
                  ))}
                </p>
              )}
              <div className="mt-2 text-right">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={send.busy || !text.trim()}
                  onClick={() => void send.run().catch(() => {})}
                >
                  {t("support.send")}
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">{t("support.viewOnly")}</p>
          )}
        </div>
      </Card>
    </>
  );
}
