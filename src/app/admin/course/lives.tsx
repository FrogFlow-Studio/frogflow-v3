import { useState } from "react";
import { deleteLiveFn, saveLiveFn } from "@/app/admin/courses.functions";
import type { AdminT } from "@/app/i18n/admin";
import { ErrorBox, useAction } from "@/app/ui";
import {
  LIVE_DURATION_MAX,
  LIVE_DURATION_MIN,
  LIVE_LINK_MAX,
  LIVE_TITLE_MAX,
  LIVES_MAX,
  type Live,
} from "@/core/courses/live";

/** Прямые эфиры курса. */

/**
 * Эфиры потока (Ш1): каждый записывается сразу своей кнопкой, отдельно от
 * «Сохранить курс». Id нового эфира задаёт форма: повтор запроса — тот же эфир.
 */
export function LivesField({
  productId,
  cohortId,
  lives,
  onChange,
  t,
}: {
  productId: string;
  cohortId: string;
  lives: Live[];
  onChange: (l: Live[]) => void;
  t: AdminT;
}) {
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  return (
    <div className="w-full space-y-1 border-t border-line pt-2">
      <p className="text-xs font-medium">{t("live.title")}</p>
      {lives.map((l) => (
        <LiveRow
          key={l.id}
          productId={productId}
          cohortId={cohortId}
          live={l}
          onSaved={onChange}
          t={t}
        />
      ))}
      {lives.length < LIVES_MAX ? (
        <LiveRow
          key={draftId}
          productId={productId}
          cohortId={cohortId}
          live={{ id: draftId, title: "", at: "", link: null }}
          fresh
          onSaved={(next) => {
            onChange(next);
            setDraftId(crypto.randomUUID());
          }}
          t={t}
        />
      ) : (
        <p className="text-xs text-muted">{t("live.full", { max: LIVES_MAX })}</p>
      )}
      <p className="text-xs text-muted">{t("live.hint")}</p>
    </div>
  );
}

function LiveRow({
  productId,
  cohortId,
  live,
  fresh = false,
  onSaved,
  t,
}: {
  productId: string;
  cohortId: string;
  live: Live;
  fresh?: boolean;
  onSaved: (l: Live[]) => void;
  t: AdminT;
}) {
  const [title, setTitle] = useState(live.title);
  const [at, setAt] = useState(live.at);
  const [link, setLink] = useState(live.link ?? "");
  const [recording, setRecording] = useState(live.recording ?? "");
  const [duration, setDuration] = useState(live.durationMin ? String(live.durationMin) : "");
  const save = useAction(async () =>
    onSaved(
      await saveLiveFn({
        data: {
          productId,
          cohortId,
          live: {
            id: live.id,
            title,
            at,
            link: link.trim() || null,
            recording: recording.trim() || null,
            ...(duration.trim() ? { durationMin: Number(duration) } : {}),
          },
        },
      }),
    ),
  );
  const remove = useAction(async () => {
    if (!window.confirm(t("live.deleteConfirm", { title: live.title }))) return;
    onSaved(await deleteLiveFn({ data: { productId, cohortId, liveId: live.id } }));
  });
  const changed =
    title !== live.title ||
    at !== live.at ||
    link !== (live.link ?? "") ||
    recording !== (live.recording ?? "") ||
    duration !== (live.durationMin ? String(live.durationMin) : "");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <input
        id={`live-title-${live.id}`}
        className="input min-w-0 flex-1"
        placeholder={t("live.name")}
        maxLength={LIVE_TITLE_MAX}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <input
        id={`live-at-${live.id}`}
        type="datetime-local"
        aria-label={t("live.at")}
        className="input w-auto"
        value={at}
        onChange={(e) => setAt(e.target.value.slice(0, 16))}
      />
      <input
        id={`live-link-${live.id}`}
        className="input min-w-0 flex-1"
        placeholder="https://zoom.us/j/…"
        aria-label={t("live.link")}
        maxLength={LIVE_LINK_MAX}
        value={link}
        onChange={(e) => setLink(e.target.value)}
      />
      <input
        id={`live-duration-${live.id}`}
        type="number"
        inputMode="numeric"
        min={LIVE_DURATION_MIN}
        max={LIVE_DURATION_MAX}
        step={5}
        className="input w-28"
        placeholder={t("live.durationPlaceholder")}
        aria-label={t("live.duration")}
        value={duration}
        onChange={(e) => setDuration(e.target.value)}
      />
      {!fresh && (
        <input
          id={`live-recording-${live.id}`}
          className="input w-full"
          placeholder={t("live.recordingPlaceholder")}
          aria-label={t("live.recording")}
          maxLength={LIVE_LINK_MAX}
          value={recording}
          onChange={(e) => setRecording(e.target.value)}
        />
      )}
      <button
        type="button"
        id={`live-save-${live.id}`}
        className="btn-secondary text-xs"
        disabled={save.busy || !changed || !title.trim() || !at}
        onClick={() => void save.run().catch(() => {})}
      >
        {fresh ? t("live.add") : t("live.save")}
      </button>
      {!fresh && (
        <button
          type="button"
          className="btn-ghost"
          aria-label={t("live.delete")}
          disabled={remove.busy}
          onClick={() => void remove.run().catch(() => {})}
        >
          ✕
        </button>
      )}
      <ErrorBox error={save.error ?? remove.error} />
    </div>
  );
}
