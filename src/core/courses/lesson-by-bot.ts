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

/**
 * Номер урока в начале подписи: «1.1», «1.2 Материалы», «3» → «1.1», «1.2», «3».
 * По нему видео попадает в уже существующий урок с этим номером в названии.
 */
export function lessonNumberOf(caption: string): string | null {
  const m = /^\s*(\d{1,2}(?:\.\d{1,2}){0,2})(?:[.)]?(?:\s|$))/.exec(caption);
  return m ? m[1]! : null;
}

/**
 * Урок с этим номером в названии: «Модуль 1 · 1.1. Знакомство», «1.1 Материалы»,
 * «Урок 3». Номер должен стоять отдельно: «1.1» не совпадёт с «1.10» или «11.1».
 */
export function lessonIndexByNumber(titles: string[], num: string): number {
  const esc = num.replace(/\./g, "\\.");
  // «1.1» — где угодно в названии отдельным числом; просто «3» — только в
  // начале или после «Урок», иначе «3» совпало бы с «Модуль 3 · 3.1».
  const re = num.includes(".")
    ? new RegExp(`(?:^|[\\s·:№#])${esc}(?!\\d|\\.\\d)`)
    : new RegExp(`^(?:(?:урок|сабақ|lesson|dars)\\s*№?\\s*)?${esc}(?!\\d|\\.\\d)`, "i");
  return titles.findIndex((t) => re.test(t));
}
