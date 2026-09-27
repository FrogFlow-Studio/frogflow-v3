import type { Page } from "@playwright/test";

/** Ошибки страницы и внешние запросы: шрифты и telegram.org в CI не нужны. */
export async function watch(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  return errors;
}
