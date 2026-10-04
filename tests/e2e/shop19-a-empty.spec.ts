import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** А7: пустой магазин — в каждом списке понятно, что это, и есть кнопка «с чего начать». */
test("пустые состояния: заказы, покупатели, категории, товары", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.EMPTY19_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.EMPTY19_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/admin/orders");
  await expect(page.getByText("Заказов пока нет", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Предпросмотр бота", exact: true }).last().click();
  await expect(page).toHaveURL(/\/admin\/bot-preview$/);

  await page.goto("/admin/customers");
  await expect(page.getByText("Покупателей пока нет", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Добавить товары", exact: true })).toBeVisible();

  await page.goto("/admin/categories");
  await expect(page.getByText("Категорий пока нет", { exact: true })).toBeVisible();
  // Кнопка в пустом состоянии открывает форму новой категории.
  await page.getByRole("status").getByRole("button").click();
  await expect(page.locator('input[name="name"]')).toBeVisible();

  await page.goto("/admin/products");
  await expect(page.getByText("Товаров нет.", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Добавить первый", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/products\/new$/);
  expect(errors).toEqual([]);
});
