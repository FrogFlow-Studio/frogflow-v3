import { isHttpsLink, LESSON_TITLE_MAX, TG_FILE_ID_RE } from "./course";

/**
 * Урок сообщением боту (settings.delivery.lessons_by_bot): продавец шлёт ссылку
 * на видео с подписью «1.2 Материалы». Берётся первая https-ссылка, название —
 * остальной текст без разделителей по краям. Нет https-ссылки — это не урок.
 */
export function lessonFromMessage(text: string | undefined): {
  title: string;
  link: string;
} | null {
  const raw = text?.trim();
  if (!raw) return null;
  const m = /https:\/\/\S+/i.exec(raw);
  if (!m) return null;
  const link = m[0].replace(/[),.;!?»"']+$/, "");
  if (!isHttpsLink(link)) return null;
  const title = (raw.slice(0, m.index) + " " + raw.slice(m.index + m[0].length))
    .replace(/\s+/g, " ")
    .replace(/^[\s—–|:-]+|[\s—–|:-]+$/g, "")
    .trim()
    .slice(0, LESSON_TITLE_MAX);
  return { title, link };
}

/**
 * Видео файлом от продавца: file_id видео (или документа-видео) и подпись —
 * название урока. Подпись со ссылкой — это урок-ссылка, не видео.
 */
export function videoLessonFromMessage(m: {
  caption?: string;
  video?: { file_id: string };
  document?: { file_id: string; mime_type?: string };
}): { title: string; tgVideo: string } | null {
  const id =
    m.video?.file_id ??
    (m.document?.mime_type?.startsWith("video/") ? m.document.file_id : undefined);
  if (!id || !TG_FILE_ID_RE.test(id)) return null;
  const title = (m.caption ?? "").replace(/\s+/g, " ").trim().slice(0, LESSON_TITLE_MAX);
  return { title, tgVideo: id };
}
