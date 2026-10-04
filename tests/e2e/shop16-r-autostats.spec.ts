import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * «Рассылки»: карточки «Брошенной корзины» и «Возврата клиентов» показывают итоги за
 * 30 дней — отправлено, не дошло, заказали после сообщения и выручку оплаченных.
 */
test("рассылки: итоги автосообщений на карточках корзины и возврата", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.AUTO16_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.AUTO16_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/admin/broadcasts");
  const cart = page.locator("section.card", { hasText: "Напоминание о брошенной корзине" });
  const stats = cart.getByTestId("auto-stats");
  await expect(stats).toContainText("Отправлено: 2, не дошло: 1");
  await expect(stats).toContainText("Заказали после сообщения: 1, оплаченных заказов: 1");
  await expect(stats).toContainText("4500 ₸");

  const winback = page.locator("section.card", { hasText: "Возвратные продажи" });
  await expect(winback.getByTestId("auto-stats")).toContainText("Отправлено: 1, не дошло: 0");
  expect(errors).toEqual([]);
});

/** «Посмотреть» на карточке корзины и возврата показывает текст с подстановками. */
test("рассылки: предпросмотр автосообщений показывает текст с подстановками", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.AUTO16_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.AUTO16_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/admin/broadcasts");
  const winback = page.locator("section.card", { hasText: "Возвратные продажи" });
  await winback.getByRole("button", { name: "Посмотреть", exact: true }).click();
  const text = winback.getByTestId("auto-preview-text").first();
  await expect(text).toBeVisible();
  await expect(text).not.toContainText("{name}");
  await expect(winback.getByTestId("auto-preview")).toContainText("Образец");
  expect(errors).toEqual([]);
});
