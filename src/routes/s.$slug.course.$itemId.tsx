import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  courseChannelInviteFn,
  courseChatInviteFn,
  courseViewFn,
  markLessonFn,
  submitHomeworkFn,
  uploadHomeworkFileFn,
} from "@/app/storefront/course.functions";
import type { CourseView } from "@/app/storefront/course.server";
import { useStorefrontLocale } from "@/app/storefront/locale";
import { COURSE_PAGE_CSP } from "@/core/courses/video";
import { intlLocale } from "@/app/i18n/admin";
import { ErrorBox, useAction } from "@/app/ui";

/**
 * Купленный курс: покупатель приходит по ссылке из сообщения о выдаче
 * (`?k=` — подпись позиции заказа). Открытые уроки — с текстом, файлами и
 * отметкой «пройден», закрытые — только название и дата открытия.
 */
export const Route = createFileRoute("/s/$slug/course/$itemId")({
  validateSearch: (s: Record<string, unknown>) => ({
    k: typeof s.k === "string" ? s.k : "",
    // Ссылка «Вступить в канал» из сообщения о выдаче: сразу выпустить приглашение.
    join: s.join === 1 || s.join === "1" ? 1 : undefined,
  }),
  loaderDeps: ({ search }) => ({ k: search.k }),
  loader: ({ params, deps }) =>
    courseViewFn({ data: { slug: params.slug, itemId: params.itemId, k: deps.k } }),
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  // Видео урока во встроенном плеере: во фреймах — только белый список хостов.
  headers: () => ({ "Content-Security-Policy": COURSE_PAGE_CSP }),
  component: CoursePage,
});

function CoursePage() {
  const view = Route.useLoaderData();
  const { slug, itemId } = Route.useParams();
  const { k, join } = Route.useSearch();
  const { t, locale } = useStorefrontLocale();
  const [done, setDone] = useState(
    () => new Set(view.lessons.filter((l) => l.done).map((l) => l.id)),
  );
  const [certificate, setCertificate] = useState(view.certificate);
  const mark = useAction(async (lessonId: string, on: boolean) => {
    const r = await markLessonFn({ data: { slug, itemId, k, lessonId, done: on } });
    setDone(new Set(r.done));
    if (r.certificate) setCertificate(r.certificate);
  });
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(intlLocale(locale), { day: "numeric", month: "long" });
  const opened = view.lessons.filter((l) => l.open).length;
  const invite = useAction(async () => {
    const r = await courseChannelInviteFn({ data: { slug, itemId, k } });
    window.location.href = r.link;
  });
  const chatInvite = useAction(async () => {
    const r = await courseChatInviteFn({ data: { slug, itemId, k } });
    window.location.href = r.link;
  });
  const autoJoin = useRef(false);
  useEffect(() => {
    if (!join || !view.channel || autoJoin.current) return;
    autoJoin.current = true;
    void invite.run().catch(() => {});
  }, [join, view.channel, invite]);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-balance">{view.name}</h1>
        <p className="text-sm text-muted tabular-nums">
          {t("course.progress", { done: done.size, total: view.lessons.length })}
        </p>
        {view.cohort && (
          <p className="text-sm text-muted">
            {t("course.cohort", { title: view.cohort.title, date: date(view.cohort.start) })}
          </p>
        )}
        {view.beforeStart && view.cohort ? (
          <p className="text-sm">{t("course.beforeStart", { date: date(view.cohort.start) })}</p>
        ) : (
          view.nextAt && (
            <p className="text-sm text-muted">{t("course.next", { date: date(view.nextAt) })}</p>
          )
        )}
        {view.expiresAt && (
          <p className={`text-sm ${view.expired ? "text-warn" : "text-muted"}`}>
            {t(view.expired ? "course.expired" : "course.expires", {
              date: date(view.expiresAt),
            })}
          </p>
        )}
      </header>
      {certificate && (
        <div className="space-y-1 rounded-md border border-line p-4">
          <p className="font-medium">🎓 {t("course.cert.yours")}</p>
          <div className="flex flex-wrap gap-3 text-sm">
            <a
              className="btn-primary"
              href={`/s/${encodeURIComponent(slug)}/cert/${certificate}/pdf`}
              target="_blank"
              rel="noreferrer"
            >
              {t("course.cert.download")}
            </a>
            <a
              className="self-center text-accent hover:underline"
              href={`/s/${encodeURIComponent(slug)}/cert/${certificate}`}
            >
              {t("course.cert.valid")}
            </a>
          </div>
        </div>
      )}
      {view.channel && (
        <div className="space-y-1">
          <button
            type="button"
            className="btn-primary"
            disabled={invite.busy}
            onClick={() => void invite.run().catch(() => {})}
          >
            {t("course.channel.join")}
          </button>
          <p className="text-xs text-muted">{t("course.channel.hint")}</p>
          <ErrorBox error={invite.error} />
        </div>
      )}
      {view.chat && (
        <div className="space-y-1">
          <button
            type="button"
            className="btn-primary"
            disabled={chatInvite.busy}
            onClick={() => void chatInvite.run().catch(() => {})}
          >
            {t("course.chat.join")}
          </button>
          <p className="text-xs text-muted">{t("course.channel.hint")}</p>
          <ErrorBox error={chatInvite.error} />
        </div>
      )}
      <ErrorBox error={mark.error} />
      <ol className="space-y-3">
        {view.lessons.map((l) => (
          <li
            key={l.id}
            className={`rounded-md border border-line p-4 ${l.open ? "" : "opacity-60"}`}
          >
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-medium">
                <span className="text-muted">{t("course.lesson", { no: l.no })}.</span> {l.title}
              </h2>
              {!l.open && (
                <span className="shrink-0 text-xs text-muted">
                  {l.gated
                    ? t("course.lockedTask", { n: l.no - 1 })
                    : t("course.locked", { date: date(l.opensAt) })}
                </span>
              )}
            </div>
            {l.open && (
              <div className="mt-2 space-y-2 text-sm">
                {l.text && <p className="leading-relaxed whitespace-pre-line">{l.text}</p>}
                {l.embed && (
                  <iframe
                    src={l.embed}
                    title={l.title}
                    className="aspect-video w-full rounded-md border-0"
                    loading="lazy"
                    allow="autoplay; fullscreen; picture-in-picture"
                    allowFullScreen
                    referrerPolicy="strict-origin-when-cross-origin"
                  />
                )}
                {l.link && (
                  <a
                    href={l.link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent hover:underline"
                  >
                    {t("course.openLink")}
                  </a>
                )}
                {l.files.length > 0 && (
                  <ul className="space-y-1">
                    {l.files.map((f) => (
                      <li key={f.url}>
                        <a
                          href={f.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent hover:underline"
                        >
                          📁 {f.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {l.homework && (
                  <HomeworkBlock
                    hw={l.homework}
                    lessonId={l.id}
                    ids={{ slug, itemId, k }}
                    t={t}
                    date={date}
                  />
                )}
                <button
                  type="button"
                  className={done.has(l.id) ? "btn-secondary text-xs" : "btn-primary text-xs"}
                  disabled={mark.busy}
                  onClick={() => void mark.run(l.id, !done.has(l.id)).catch(() => {})}
                >
                  {done.has(l.id) ? t("course.done") : t("course.markDone")}
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
      {opened > 0 && view.lessons.some((l) => l.files.length > 0) && (
        <p className="text-xs text-muted">{t("course.linkHint")}</p>
      )}
    </div>
  );
}

type T = ReturnType<typeof useStorefrontLocale>["t"];
type Hw = NonNullable<CourseView["lessons"][number]["homework"]>;

/** Файл ответа — до 3 МБ: фото с телефона сжимаем в браузере до 2000 пикселей. */
const HW_MAX_BYTES = 3 * 1024 * 1024;

async function shrinkImage(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size <= HW_MAX_BYTES * 0.8) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

async function toBase64(blob: Blob): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  return url.slice(url.indexOf(",") + 1);
}

function HomeworkBlock({
  hw,
  lessonId,
  ids,
  t,
  date,
}: {
  hw: Hw;
  lessonId: string;
  ids: { slug: string; itemId: string; k: string };
  t: T;
  date: (iso: string) => string;
}) {
  const [status, setStatus] = useState(hw.status);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sent, setSent] = useState(false);
  const send = useAction(async () => {
    const uploaded = [];
    for (const f of files) {
      const blob = await shrinkImage(f);
      uploaded.push(
        await uploadHomeworkFileFn({
          data: { ...ids, name: f.name, data: await toBase64(blob) },
        }),
      );
    }
    const r = await submitHomeworkFn({ data: { ...ids, lessonId, text, files: uploaded } });
    setStatus(r.status);
    setText("");
    setFiles([]);
    setSent(true);
  });
  const tone = status === "accepted" ? "text-ok" : status === "revise" ? "text-warn" : "text-muted";
  return (
    <section className="mt-3 space-y-2 rounded-md bg-surface-2 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-medium">📝 {t("course.hw.title")}</h3>
        {status && <span className={`text-xs ${tone}`}>{t(`course.hw.status.${status}`)}</span>}
      </div>
      <p className="whitespace-pre-line">{hw.task}</p>
      {hw.last && (
        <div className="text-xs text-muted">
          <p>
            {t("course.hw.yourAnswer")} · {date(hw.last.at)}
          </p>
          {hw.last.text && <p className="whitespace-pre-line">{hw.last.text}</p>}
          {hw.last.files.map((f) => (
            <a
              key={f.url}
              href={f.url}
              target="_blank"
              rel="noreferrer"
              className="mr-2 text-accent hover:underline"
            >
              📎 {f.name}
            </a>
          ))}
        </div>
      )}
      {hw.feedback && (
        <div className="rounded-md border border-line p-2">
          <p className="text-xs text-muted">
            {t("course.hw.feedback")} · {date(hw.feedback.at)}
          </p>
          <p className="whitespace-pre-line">{hw.feedback.text}</p>
        </div>
      )}
      {sent && <p className="text-xs text-ok">{t("course.hw.sent")}</p>}
      {!hw.canSubmit && <p className="text-xs text-muted">{t("course.hw.notInTariff")}</p>}
      {hw.canSubmit && status !== "accepted" && status !== "submitted" && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send.run().catch(() => {});
          }}
        >
          <textarea
            className="input min-h-20"
            value={text}
            maxLength={4000}
            placeholder={t("course.hw.placeholder")}
            onChange={(e) => setText(e.target.value)}
          />
          <label className="block text-xs">
            <span className="text-accent">📎 {t("course.hw.attach")}</span>
            <input
              type="file"
              multiple
              accept="image/*,application/pdf,video/mp4,video/quicktime"
              className="mt-1 block text-xs"
              onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, 5))}
            />
            <span className="text-muted">{t("course.hw.filesLimit")}</span>
          </label>
          <button
            className="btn-primary text-xs"
            disabled={send.busy || (!text.trim() && files.length === 0)}
          >
            {status === "revise" ? t("course.hw.resubmit") : t("course.hw.submit")}
          </button>
          <ErrorBox error={send.error} />
        </form>
      )}
    </section>
  );
}
