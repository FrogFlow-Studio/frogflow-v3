import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * «Отзывы» продавца: 45 отзывов видны постранично целиком, а средняя оценка и счётчики
 * считаются по всем 45, а не по странице; фильтры «ждут одобрения» и по товару.
 */
test("отзывы: все постранично, сводка по всем, фильтры", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.REV16_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.REV16_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  const cards = page.getByRole("button", { name: "Ответить", exact: true });
  await page.goto("/admin/reviews");
  await expect(
    page.getByText("Средняя оценка: 4.6 из 5 · отзывов: 45 · Ждут решения: 5 · без ответа: 45", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(cards).toHaveCount(20);
  await expect(page.getByText("Страница 1 из 3", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Вперёд", exact: true }).click();
  await expect(page.getByText("Страница 2 из 3", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Вперёд", exact: true }).click();
  await expect(page.getByText("Страница 3 из 3", { exact: true })).toBeVisible();
  await expect(cards).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Вперёд", exact: true })).toBeDisabled();

  // Фильтр «Ждут одобрения»: только 5 старых отзывов на пирог; сводка прежняя.
  await page.goto("/admin/reviews");
  await page.getByLabel("Ждут одобрения", { exact: true }).click();
  await expect(cards).toHaveCount(F.REV16_PIE_REVIEWS);
  await expect(page.getByText("Страница", { exact: false })).toHaveCount(0);
  await expect(page.getByText("отзывов: 45", { exact: false })).toBeVisible();

  // Фильтр по товару.
  await page.goto("/admin/reviews");
  await page.getByLabel("Все товары", { exact: true }).selectOption(F.REV16_PIE_ID);
  await expect(cards).toHaveCount(F.REV16_PIE_REVIEWS);
  expect(errors).toEqual([]);
});
