import { useState } from "react";
import { chatUnansweredSaveFn, quickRepliesSaveFn } from "@/app/admin/chat.functions";
import { type AdminT } from "@/app/i18n/admin";
import { ErrorBox, useAction } from "@/app/ui";
import { UNANSWERED_OPTIONS } from "@/core/chat/unanswered";
import { type QuickReply } from "@/core/inbox/inbox";

/** Через сколько минут без ответа напомнить продавцу в Telegram (крон, core/chat/unanswered). */
export function UnansweredAlert({
  t,
  initial,
  initialEscalate,
  canWrite,
}: {
  t: AdminT;
  initial: number;
  initialEscalate: boolean;
  canWrite: boolean;
}) {
  const [minutes, setMinutes] = useState(initial);
  const [escalate, setEscalate] = useState(initialEscalate);
  const save = useAction(async (m: number, e: boolean) => {
    const r = await chatUnansweredSaveFn({ data: { minutes: m, escalate: e } });
    setMinutes(r.minutes);
    setEscalate(e);
  });
  const option = (m: number) =>
    m === 0
      ? t("chat.unansweredOff")
      : m < 60
        ? t("chat.unansweredMin", { n: m })
        : t("chat.unansweredHours", { n: m / 60 });
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
      <label htmlFor="unanswered" className="text-muted">
        {t("chat.unanswered")}
      </label>
      <select
        id="unanswered"
        className="input w-auto"
        value={minutes}
        disabled={!canWrite || save.busy}
        onChange={(e) => void save.run(Number(e.target.value), escalate).catch(() => {})}
      >
        {UNANSWERED_OPTIONS.map((m) => (
          <option key={m} value={m}>
            {option(m)}
          </option>
        ))}
      </select>
      <span className="text-xs text-muted">{t("chat.unansweredHint")}</span>
      {minutes > 0 && (
        <label className="flex basis-full items-center gap-2 text-muted">
          <input
            type="checkbox"
            checked={escalate}
            disabled={!canWrite || save.busy}
            onChange={(e) => void save.run(minutes, e.target.checked).catch(() => {})}
          />
          {t("chat.unansweredEscalate")}
        </label>
      )}
      <ErrorBox error={save.error} />
    </div>
  );
}

export function QuickReplies({
  t,
  replies,
  editing,
  onEdit,
  onSaved,
  onPick,
}: {
  t: AdminT;
  replies: QuickReply[];
  editing: boolean;
  onEdit: (v: boolean) => void;
  onSaved: (r: QuickReply[]) => void;
  onPick: (r: QuickReply) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<QuickReply[]>(replies);
  const save = useAction(async () => {
    const r = await quickRepliesSaveFn({ data: { replies: draft } });
    onSaved(r.replies);
    onEdit(false);
  });
  if (editing)
    return (
      <div className="max-h-[50%] overflow-y-auto border-t border-line p-3">
        <ErrorBox error={save.error} />
        <p className="mb-2 text-xs text-muted">{t("chat.quickText")}</p>
        <div className="flex flex-col gap-2">
          {draft.map((r, i) => (
            <div key={i} className="flex flex-col gap-1 rounded-md border border-line p-2">
              <div className="flex gap-2">
                <input
                  className="input flex-1"
                  placeholder={t("chat.quickTitle")}
                  value={r.title}
                  maxLength={60}
                  onChange={(e) =>
                    setDraft(draft.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                  }
                />
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => setDraft(draft.filter((_, j) => j !== i))}
                >
                  {t("chat.quickRemove")}
                </button>
              </div>
              <textarea
                className="input"
                rows={2}
                maxLength={2000}
                value={r.text}
                onChange={(e) =>
                  setDraft(draft.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
                }
              />
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={draft.length >= 30}
            onClick={() => setDraft([...draft, { title: "", text: "" }])}
          >
            {t("chat.quickAdd")}
          </button>
          <button
            type="button"
            className="btn-primary text-xs"
            disabled={save.busy}
            onClick={() => void save.run().catch(() => {})}
          >
            {t("chat.quickSave")}
          </button>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => {
              setDraft(replies);
              onEdit(false);
            }}
          >
            {t("chat.quickCancel")}
          </button>
        </div>
      </div>
    );
  return (
    <div className="flex items-center gap-2 overflow-x-auto border-t border-line px-3 py-2">
      <span className="shrink-0 text-xs text-muted">{t("chat.quick")}:</span>
      {replies.length === 0 && (
        <span className="truncate text-xs text-muted">{t("chat.quickEmpty")}</span>
      )}
      {replies.map((r, i) => (
        <button
          key={i}
          type="button"
          title={r.text}
          className="badge shrink-0 cursor-pointer hover:bg-surface-2"
          onClick={() => onPick(r)}
        >
          {r.title}
        </button>
      ))}
      <button
        type="button"
        className="ml-auto shrink-0 text-xs text-accent hover:underline"
        onClick={() => {
          setDraft(replies.length ? replies : [{ title: "", text: "" }]);
          onEdit(true);
        }}
      >
        {t("chat.quickEdit")}
      </button>
    </div>
  );
}
