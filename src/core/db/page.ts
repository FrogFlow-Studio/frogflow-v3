/**
 * PostgREST молча обрезает любой select на 1000 строках. Всё, что читает
 * «всех покупателей» или «все заказы», идёт постранично через этот помощник.
 */
export async function pageAll<T>(
  query: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  what: string,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await query(from, from + pageSize - 1);
    if (error) throw new Error(`${what}: ${error.message}`);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

/**
 * То же постранично, но без накопления: `each` получает страницу и может
 * вернуть false — дальше не читать (крон набрал свою пачку). Для обходов,
 * где держать в памяти все строки незачем.
 */
export async function eachPage<T>(
  query: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  what: string,
  each: (rows: T[]) => unknown,
  pageSize = 1000,
): Promise<void> {
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await query(from, from + pageSize - 1);
    if (error) throw new Error(`${what}: ${error.message}`);
    const rows = data ?? [];
    if (rows.length && (await each(rows)) === false) return;
    if (rows.length < pageSize) return;
  }
}
