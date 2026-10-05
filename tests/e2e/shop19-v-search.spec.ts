import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch, openFilters } from "./helpers.ts";

/** Поиск товаров по площадке (В8): находит у показанных магазинов, скрытый не показывает. */
const S = F.MARKET19_SHOPS;
const I = F.MARKET19_ITEMS;

test("поиск товаров: медовик найден в показанном магазине, у скрытого — нет", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/market");
  await page.getByRole("link", { name: "Все товары", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Поиск товаров на FrogFlow");
  await expect(page.getByText("Введите слово или несколько")).toBeVisible();
  await openFilters(page);
  await page.getByRole("textbox", { name: "Что ищете", exact: true }).fill("медовик");
  await page.getByRole("button", { name: "Найти", exact: true }).click();
  await expect(page.getByRole("heading", { name: I.honey.name, exact: true })).toBeVisible();
  await expect(page.getByText(`в магазине ${S.cake.name}`)).toBeVisible();
  await expect(page.getByText(I.hiddenHoney.name)).toHaveCount(0);
  await expect(page.getByText(I.rose.name)).toHaveCount(0);
  // Две ссылки на магазин: имя автора и «Открыть магазин».
  await expect(page.locator(`a[href="/s/${S.cake.slug}"]`)).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("поиск товаров: ничего не нашли и казахский язык", async ({ page }) => {
  await watch(page);
  await page.goto("/market/search?q=несуществующее");
  await expect(page.getByText("Ничего не нашли. Попробуйте другое слово.")).toBeVisible();
  await page.goto("/market/search?lang=kk");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("FrogFlow-да тауар іздеу");
});
