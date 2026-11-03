/** Оформление курса в чате (курс в боте): названия уроков, модули, прогресс. */

/** «▰▰▱▱▱▱▱▱▱▱» — пройдено из всего, 10 делений. */
export function progressBar(done: number, total: number): string {
  const n = total > 0 ? Math.round((Math.min(done, total) / total) * 10) : 0;
  return "▰".repeat(n) + "▱".repeat(10 - n);
}

/** «Модуль 1 · 1.1. Знакомство» → «Модуль 1»; без модуля — null. */
export function moduleOf(title: string): string | null {
  const m = /^([^·\d]{1,20}\d{1,2})\s*·\s*\d/u.exec(title);
  return m ? m[1]!.trim() : null;
}

/**
 * Название урока в чате без приставки модуля, если номер урока в нём есть:
 * «Модуль 1 · 1.1. Знакомство» → «1.1. Знакомство»; иначе «N. Название».
 */
export function shortTitle(title: string, no: number): string {
  const t = title.replace(/^[^·\d]{1,20}\d{1,2}\s*·\s*(?=\d)/u, "");
  return /^\d/.test(t) ? t : `${no}. ${t}`;
}
