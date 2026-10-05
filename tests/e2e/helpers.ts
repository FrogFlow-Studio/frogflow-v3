import { expect, type Page } from "@playwright/test";

/** Ошибки страницы и внешние запросы: шрифты и telegram.org в CI не нужны. */
export async function watch(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  return errors;
}

/** На телефоне фильтры витрины спрятаны в панель «Фильтры»; на компьютере они на виду. */
export async function openFilters(page: Page): Promise<void> {
  const button = page.getByRole("button", { name: /Фильтры/ });
  if (!(await button.isVisible())) return;
  // Клик до гидратации страницы ничего не открывает: повторяем, пока панель не раскроется.
  await expect(async () => {
    if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true", { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}
