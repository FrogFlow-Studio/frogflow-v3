import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch, openFilters } from "./helpers.ts";

/** Площадка (В7): каталог показывает только согласных и одобренных, фильтры и поиск работают. */
const S = F.MARKET19_SHOPS;

test("площадка: два магазина из четырёх, скрытый и магазин прежней платформы не видны", async ({
  page,
}) => {
  const errors = await watch(page);
  await page.goto("/market");
  await expect(page).toHaveTitle("Магазины на FrogFlow");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Магазины на FrogFlow");
  await expect(page.getByRole("heading", { name: S.cake.name, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: S.rose.name, exact: true })).toBeVisible();
  await expect(page.getByText(S.hidden.name)).toHaveCount(0);
  await expect(page.getByText(S.old.name)).toHaveCount(0);
  // Ссылки ведут в витрины показанных магазинов, по названию: Розарий раньше Сладкой Лавки.
  await expect(page.locator(`a[href="/s/${S.rose.slug}"]`)).toHaveCount(1);
  await expect(page.locator(`a[href="/s/${S.cake.slug}"]`)).toHaveCount(1);
  await expect(page.locator(`a[href="/s/${S.hidden.slug}"]`)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Открыть магазин", exact: true })).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("площадка: фильтр по городу и поиск по названию", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/market");
  await openFilters(page);
  await page.getByRole("combobox", { name: "Город", exact: true }).selectOption("Астана");
  await page.getByRole("button", { name: "Найти", exact: true }).click();
  await expect(page).toHaveURL(/city=%D0%90%D1%81%D1%82%D0%B0%D0%BD%D0%B0|city=Астана/);
  await expect(page.getByRole("heading", { name: S.rose.name, exact: true })).toBeVisible();
  await expect(page.getByText(S.cake.name)).toHaveCount(0);

  await page.goto("/market");
  await page.getByRole("textbox", { name: "Поиск по названию", exact: true }).fill("Лавка");
  await page.getByRole("button", { name: "Найти", exact: true }).click();
  await expect(page.getByRole("heading", { name: S.cake.name, exact: true })).toBeVisible();
  await expect(page.getByText(S.rose.name)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("площадка на казахском и узбекском", async ({ page }) => {
  await watch(page);
  await page.goto("/market?lang=kk");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("FrogFlow дүкендері");
  await page.goto("/market?lang=uz");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("FrogFlow do‘konlari");
});
