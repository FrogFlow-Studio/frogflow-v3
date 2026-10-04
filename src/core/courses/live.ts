/**
 * Эфиры потока (ниша «Онлайн-школа»): живые занятия по расписанию —
 * вебинар в Zoom, Google Meet или Telegram. Хранятся в потоке, в той же
 * записи курса `app_settings` (`cohorts[].lives`). Чистый модуль: его
 * читает и форма в браузере.
 */
// Без импорта из ./course: он сам разбирает эфиры отсюда (круг модулей).
export const LIVES_MAX = 30;
export const LIVE_TITLE_MAX = 200;
export const LIVE_LINK_MAX = 500;
const LOCAL_START_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function isHttpsLink(v: string): boolean {
  if (v.length > LIVE_LINK_MAX) return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

export type Live = {
  id: string;
  title: string;
  /** Начало в поясе магазина: «YYYY-MM-DDTHH:MM». */
  at: string;
  /** Ссылка на эфир, только https; null — ещё не известна. */
  link: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Верна ли местная дата-время: формат и настоящий день (31 февраля — нет). */
export function isLocalStart(v: string): boolean {
  if (!LOCAL_START_RE.test(v)) return false;
  const d = new Date(`${v}:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 16) === v;
}

/** Эфиры потока из записи курса: битые пропускаются, порядок — по началу. */
export function parseLives(v: unknown): Live[] {
  const out: Live[] = [];
  for (const x of Array.isArray(v) ? v : []) {
    const o = (x ?? {}) as Record<string, unknown>;
    const id = str(o.id, 36);
    const title = str(o.title, LIVE_TITLE_MAX);
    const at = str(o.at, 16);
    const link = str(o.link, LIVE_LINK_MAX);
    if (!UUID.test(id) || !title || !isLocalStart(at) || out.some((l) => l.id === id)) continue;
    out.push({ id, title, at, link: link && isHttpsLink(link) ? link : null });
    if (out.length >= LIVES_MAX) break;
  }
  return sortLives(out);
}

/** По началу; местное время одного пояса сравнивается строкой. */
export function sortLives<T extends { at: string; id: string }>(lives: readonly T[]): T[] {
  return [...lives].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

export type LiveProblem = "noTitle" | "badTime" | "badLink" | "tooMany" | "noCohort";

/** Проверка эфира перед записью (поля уже обрезаны по краям). */
export function liveProblem(l: Live): LiveProblem | null {
  if (!l.title || l.title.length > LIVE_TITLE_MAX) return "noTitle";
  if (!isLocalStart(l.at)) return "badTime";
  if (l.link && !isHttpsLink(l.link)) return "badLink";
  return null;
}

/**
 * Эфиры потока после правки: тот же id — замена (повтор того же запроса,
 * двойной клик или правка), новый — добавление, пока не больше LIVES_MAX.
 */
export function upsertLive(lives: readonly Live[], live: Live): Live[] | "tooMany" {
  if (lives.some((l) => l.id === live.id))
    return sortLives(lives.map((l) => (l.id === live.id ? live : l)));
  if (lives.length >= LIVES_MAX) return "tooMany";
  return sortLives([...lives, live]);
}
