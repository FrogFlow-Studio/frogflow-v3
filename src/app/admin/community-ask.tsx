import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { askCommunityAdviceFn, communityAdviceReadyFn } from "@/app/admin/community.functions";
import type { AdminT } from "@/app/i18n/admin";
import { ErrorBox, useAction } from "@/app/ui";
import type { AdvicePage } from "@/core/community/rules";

/**
 * «Спросить совет у авторов» на странице админки. Тема уходит в раздел «Вопросы» сообщества с
 * названием раздела и вашим вопросом; суммы, покупатели и заказы магазина в неё не попадают.
 * Кнопки нет, пока вы не в сообществе или таблиц в базе ещё нет.
 */
export function AskCommunityAdvice({ page, t }: { page: AdvicePage; t: AdminT }) {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    void communityAdviceReadyFn()
      .then((r) => setReady(r.ready))
      .catch(() => {});
  }, []);
  const send = useAction(async () => {
    const r = await askCommunityAdviceFn({ data: { page, question } });
    if (r.soon) return;
    setQuestion("");
    setDone(true);
  });
  if (!ready) return null;
  return (
    <div className="mb-4">
      <button
        className="btn-secondary"
        onClick={() => {
          setOpen((v) => !v);
          setDone(false);
        }}
      >
        {t("community.ask.button")}
      </button>
      {open && (
        <form
          className="card mt-2 space-y-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send.run().catch(() => {});
          }}
        >
          <p className="text-xs text-muted">{t("community.ask.hint")}</p>
          <textarea
            className="input min-h-24"
            maxLength={4000}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button className="btn-primary" disabled={send.busy || !question.trim()}>
            {t("community.ask.send")}
          </button>
          {done && (
            <p className="text-sm text-ok">
              {t("community.ask.done")} <Link to="/admin/community">{t("community.ask.open")}</Link>
            </p>
          )}
          <ErrorBox error={send.error} />
        </form>
      )}
    </div>
  );
}
