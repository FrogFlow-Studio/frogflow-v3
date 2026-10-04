/** Таблицы площадки нет в базе (миграция не применена): разделы пишут «скоро». */
export class MarketplaceNotReady extends Error {
  constructor() {
    super("marketplace-not-ready");
    this.name = "MarketplaceNotReady";
  }
}

/** PostgREST отвечает PGRST205, Postgres — 42P01. */
export function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  return /could not find the table|relation .* does not exist/i.test(error.message ?? "");
}
