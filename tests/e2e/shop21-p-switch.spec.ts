import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** Площадка (П1): переключатель «Авторы / Все товары», фильтр по категории, автор под товаром. */
const S = F.MARKET19_SHOPS;
const I = F.MARKET19_ITEMS;

test("переключатель Авторы / Все товары и фильтр по категории", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/market");
  await page.getByRole("link", { name: "Все товары", exact: true }).click();
  await expect(page).toHaveURL(/\/market\/search/);
  await page.getByRole("combobox", { name: "Категория", exact: true }).selectOption("Цветы");
  await page.getByRole("button", { name: "Найти", exact: true }).click();
  await expect(page.getByRole("heading", { name: I.rose.name, exact: true })).toBeVisible();
  await expect(page.getByText(I.honey.name)).toHaveCount(0);
  // Имя автора под товаром ведёт в его витрину.
  await page.getByRole("link", { name: S.rose.name, exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`/s/${S.rose.slug}$`));
  await page.goBack();
  await page.getByRole("link", { name: "Авторы", exact: true }).click();
  await expect(page).toHaveURL(/\/market(\?|$)/);
  await expect(page.getByRole("heading", { name: S.rose.name, exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
