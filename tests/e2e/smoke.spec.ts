import { expect, test, type Page } from "@playwright/test";

/**
 * Сквозной прогон собранного приложения в браузере. Ловит то, чего не видят
 * модульные тесты: сборка поднимается, страницы рисуются и оживают, серверные
 * функции отвечают. После #30 все /_serverFn на проде отдавали 500, а главная
 * молча прятала кнопку регистрации — модульные тесты при этом были зелёными.
 */

/** Ошибки страницы и внешние запросы: шрифты и telegram.org в CI не нужны. */
async function watch(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  return errors;
}

test("главная: страница рисуется, серверная функция отвечает — есть кнопка регистрации", async ({
  page,
}) => {
  const errors = await watch(page);
  await page.goto("/");
  await expect(page).toHaveTitle(/FrogFlow/);
  // Кнопка регистрации появляется, только если signupEnabledFn ответила.
  await expect(page.locator('a[href="/signup"]').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("вход продавца: неверный пароль — понятная фраза, а не сырой текст ошибки", async ({
  page,
}) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await expect(page.getByRole("heading", { name: "Вход в панель магазина" })).toBeVisible();
  await page.locator('input[name="username"]').fill("nobody");
  await page.locator('input[name="password"]').fill("wrong-password");
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByText("Неверный логин или пароль")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(
    /Cannot read|undefined|TypeError|Internal Server Error/,
  );
  expect(errors).toEqual([]);
});

test("панели без входа уводят на страницу входа", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.goto("/operator");
  await expect(page).toHaveURL(/\/operator\/login$/);
  expect(errors).toEqual([]);
});

test("регистрация открыта: форма на месте", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Открыть магазин" })).toBeVisible();
  await expect(page.locator('input[name="username"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test("витрина: неизвестный магазин — страница «Магазин не найден»", async ({ page }) => {
  const errors = await watch(page);
  const res = await page.goto("/s/net-takogo-magazina");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Магазин не найден" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("маршруты /api отвечают: крон без секрета — 401, а не 500", async ({ request }) => {
  expect((await request.get("/api/cron/health")).status()).toBe(401);
  expect((await request.get("/api/health")).status()).toBe(200);
  expect((await request.get("/robots.txt")).status()).toBe(200);
});
