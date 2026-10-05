import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** Р4: «Пробный заказ» не создаёт заказ и показывает, чего не хватает для покупки. */
test("пробный заказ: проверка без заказа показывает, что мешает покупке", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.TRIAL22_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.TRIAL22_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  const box = page.getByTestId("trial-order");
  await expect(box).toBeVisible();
  // Телефон: карточка запуска с пробным заказом не даёт горизонтальной прокрутки.
  const wide = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(wide).toBe(false);

  await box.getByRole("button", { name: "Пробный заказ", exact: true }).click();
  const result = box.getByRole("status");
  await expect(result).toContainText("Пробный заказ не прошёл");
  await expect(result).toContainText("Бот Telegram не подключён");
  // Цена посчитана тем же расчётом, что в корзине.
  await expect(result).toContainText("3");

  // Заказов не появилось.
  await page.goto("/admin/orders");
  await expect(page.getByText(F.TRIAL22_ITEM_NAME, { exact: false })).toHaveCount(0);
  expect(errors).toEqual([]);
});
