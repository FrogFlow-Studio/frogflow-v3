import { useState } from "react";
import { previewAutoMessageFn, sendAutoPreviewFn } from "@/app/admin/automsg-preview.functions";
import type { AdminT } from "@/app/i18n/admin";
import { ErrorBox, useAction } from "@/app/ui";

type Kind = "cart" | "winback" | "similar";
type PreviewData = Awaited<ReturnType<typeof previewAutoMessageFn>>;

/** «Посмотреть» и «Отправить себе»: тот же текст, что уйдёт покупателю (Р5). */
export function AutoPreview({
  t,
  kind,
  draft,
}: {
  t: AdminT;
  kind: Kind;
  /** Несохранённые правки формы — предпросмотр показывает их. */
  draft?: Record<string, unknown>;
}) {
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const view = useAction(async () => {
    setNote(null);
    setPreview(await previewAutoMessageFn({ data: { kind, draft } }));
  });
  const send = useAction(async () => {
    const r = await sendAutoPreviewFn({ data: { kind, draft } });
    setNote(r.sent > 0 ? t("autopreview.sent", { n: r.sent }) : t("autopreview.nowhere"));
  });
  return (
    <div className="mt-3 space-y-2" data-testid="auto-preview">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary"
          disabled={view.busy}
          onClick={() => void view.run().catch(() => {})}
        >
          {t("autopreview.view")}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={send.busy}
          onClick={() => void send.run().catch(() => {})}
        >
          {t("autopreview.sendSelf")}
        </button>
      </div>
      {preview && (
        <div className="rounded-lg border border-line p-2 text-sm">
          <p className="text-xs text-muted">
            {preview.buyer
              ? t("autopreview.buyer", { name: preview.buyer })
              : t("autopreview.sample")}
          </p>
          {preview.texts.map((text, i) => (
            <p key={i} className="mt-2 whitespace-pre-wrap" data-testid="auto-preview-text">
              {text}
            </p>
          ))}
          {preview.buttons.map((b) => (
            <p key={b} className="mt-1 text-xs text-muted">
              [{b}]
            </p>
          ))}
        </div>
      )}
      {note && <p className="text-xs text-ok">{note}</p>}
      <ErrorBox error={view.error ?? send.error} />
    </div>
  );
}
