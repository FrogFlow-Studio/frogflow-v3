import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Витрина: у карточки и страницы товара одна оценка — только по одобренным отзывам
 * («4.5 (12)», а не 4.0 по всем четырнадцати), разметка для поиска — те же числа;
 * на странице товара «Показать ещё» и фильтры по оценке и «с фото».
 */
const product = `/s/${F.FLT16_SHOP_SLUG}/p/${F.FLT16_PRODUCT_ID}`;

test("витрина: оценка карточки = страницы = разметки, только по одобренным отзывам", async ({
  page,
}) => {
  const errors = await watch(page);
  await page.goto(`/s/${F.FLT16_SHOP_SLUG}`);
  await expect(page.getByText("⭐ 4.5 (12)", { exact: true })).toBeVisible();
  await page.goto(product);
  await expect(page.getByText("★ 4.5 · 12 отзывов", { exact: true })).toBeVisible();
  const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
  const markup = ld.join("");
  expect(markup).toContain('"ratingValue":4.5');
  expect(markup).toContain('"reviewCount":12');
  expect(errors).toEqual([]);
});

test("страница товара: «Показать ещё» и фильтры отзывов", async ({ page }) => {
  const errors = await watch(page);
  await page.goto(product);
  const reviews = page.getByText(/^Отзыв витрины \d+$/);
  await expect(reviews).toHaveCount(10);
  await page.getByRole("button", { name: "Показать ещё", exact: true }).click();
  await expect(reviews).toHaveCount(12);
  await expect(page.getByRole("button", { name: "Показать ещё", exact: true })).toHaveCount(0);
  // Скрытый и ждущий решения отзывы покупателю не видны.
  await expect(page.getByText("Отзыв витрины 13", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Отзыв витрины 14", { exact: true })).toHaveCount(0);

  await page.getByLabel("С фото", { exact: true }).check();
  await expect(reviews).toHaveCount(3);
  await page.getByLabel("С фото", { exact: true }).uncheck();
  await page.getByLabel("Оценка", { exact: true }).selectOption("4");
  await expect(reviews).toHaveCount(6);
  await page.getByLabel("С фото", { exact: true }).check();
  await expect(reviews).toHaveCount(1);
  await page.getByLabel("Оценка", { exact: true }).selectOption("1");
  await expect(page.getByText("Нет отзывов по выбранным фильтрам.", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
