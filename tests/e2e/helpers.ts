import { expect, type Page } from "@playwright/test";

/** Ошибки страницы и внешние запросы: шрифты и telegram.org в CI не нужны. */
export async function watch(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  waitForHydrationOnLoad(page);
  return errors;
}

/**
 * `goto` и `reload` возвращают страницу, когда React её уже взял. До гидратации клик по кнопке
 * ничего не делает, ввод в поле не вызывает обработчик, а выбор в `<select>` гидратация
 * сбрасывает: под нагрузкой (4 потока Playwright) такие шаги терялись в разных specs.
 */
export function waitForHydrationOnLoad(page: Page): void {
  for (const method of ["goto", "reload"] as const) {
    const original = page[method].bind(page) as (...args: unknown[]) => ReturnType<Page["goto"]>;
    (page as unknown as Record<string, unknown>)[method] = async (...args: unknown[]) => {
      const response = await original(...args);
      if (response?.headers()["content-type"]?.startsWith("text/html"))
        await page.waitForFunction(() =>
          Object.keys(document.body ?? {}).some((k) => k.startsWith("__reactFiber")),
        );
      return response;
    };
  }
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

/**
 * «В корзину» на странице товара. Клик до гидратации ничего не кладёт, и оформление
 * открывается с пустой корзиной: повторяем, пока не появится «Добавлено в корзину».
 * Корзина в браузере, сервер не участвует: зарегистрированный клик сразу даёт надпись.
 */
export async function addToCart(page: Page): Promise<void> {
  const button = page.getByRole("button", { name: "🛒 В корзину", exact: true });
  const added = page.getByText("Добавлено в корзину", { exact: true });
  await expect(async () => {
    if (!(await added.isVisible())) await button.click();
    await expect(added).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}

/**
 * Ждёт, пока React возьмёт элемент страницы. До гидратации клик по кнопке ничего
 * не делает, а выбор в `<select>` гидратация сбрасывает на `defaultValue`: под
 * нагрузкой (несколько потоков Playwright) такие шаги теряются.
 */
export async function hydrated(page: Page, selector: string): Promise<void> {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactFiber"));
  }, selector);
}
