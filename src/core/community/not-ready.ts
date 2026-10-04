/**
 * Таблиц сообщества в базе может ещё не быть: миграцию 19-2 применяет Яков своим словом.
 * Тогда код не падает, а отвечает «скоро». PostgREST говорит об этом кодом PGRST205
 * (таблицы нет в кеше схемы), Postgres — 42P01.
 */
export class CommunityNotReady extends Error {
  constructor() {
    super("community tables are not installed");
    this.name = "CommunityNotReady";
  }
}

export function isMissingTable(e: { code?: string | undefined; message?: string } | null): boolean {
  if (!e) return false;
  if (e.code === "PGRST205" || e.code === "42P01") return true;
  return /could not find the table|relation .* does not exist/i.test(e.message ?? "");
}

/** Ответ функций сообщества: либо данные, либо «скоро» (таблиц ещё нет). */
export type Soonable<T> = ({ soon: false } & T) | { soon: true };

export async function orSoon<T extends object>(run: () => Promise<T>): Promise<Soonable<T>> {
  try {
    return { soon: false, ...(await run()) };
  } catch (e) {
    if (e instanceof CommunityNotReady) return { soon: true };
    throw e;
  }
}
