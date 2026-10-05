import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch, openFilters } from "./helpers.ts";

/**
 * Магазин автора с площадки (П2): плашка «Вы смотрите только магазин…», вкладки и возврат к
 * списку с тем же фильтром. Прямая ссылка на магазин остаётся без плашки.
 */
const S = F.SH20_SHOP;
const P = F.SH20_PRODUCT;

test("площадка → фильтр → магазин → «Вернуться ко всем товарам» сохраняет фильтр", async ({
  page,
}) => {
  const errors = await watch(page);
  await page.goto("/market/search?category=Торты&q=пряник");
  await expect(page.getByRole("heading", { name: P.name, exact: true })).toBeVisible();
  await page.locator(`a[href="/s/${S.slug}"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`/s/${S.slug}$`));

  const band = page.getByTestId("market-band");
  await expect(
    band.getByText(`Вы смотрите только магазин «${S.name}»`, { exact: true }),
  ).toBeVisible();
  await expect(band.getByRole("link", { name: "Витрина", exact: true })).toBeVisible();
  // Плашка остаётся на других страницах магазина.
  await page.goto(`/s/${S.slug}/p/${P.id}`);
  await expect(page.getByTestId("market-band")).toBeVisible();

  await page.getByRole("link", { name: "Вернуться ко всем товарам", exact: true }).click();
  await expect(page).toHaveURL(/\/market\/search\?.*category=/);
  await openFilters(page);
  await expect(page.getByRole("combobox", { name: "Категория", exact: true })).toHaveValue("Торты");
  await expect(page.getByRole("textbox", { name: "Что ищете", exact: true })).toHaveValue("пряник");
  expect(errors).toEqual([]);
});

test("прямая ссылка на магазин: плашки с площадки нет", async ({ page }) => {
  await watch(page);
  await page.goto(`/s/${S.slug}`);
  await expect(
    page.getByRole("heading", { name: S.name, exact: true }).or(page.getByText(S.name).first()),
  ).toBeVisible();
  await expect(page.getByTestId("market-band")).toHaveCount(0);
});

test("цифры доверия не выдумываются: без посчитанных заказов строки на плашке нет", async ({
  page,
}) => {
  await watch(page);
  await page.goto(`/market/search?category=Торты`);
  await page.locator(`a[href="/s/${S.slug}"]`).first().click();
  await expect(page.getByTestId("market-band")).toBeVisible();
  await expect(page.getByTestId("market-trust")).toHaveCount(0);
});
