import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * В15: страница подборки по ссылке. Показывается только то, что покупатель может
 * купить сейчас; пустая подборка не падает и не попадает в поиск.
 */
test("подборка: только товар в наличии, закончившийся и снятый не видны", async ({ page }) => {
  const errors = await watch(page);
  await page.goto(`/s/${F.COL19_SHOP_SLUG}/col/${F.COL19_CODE}`);
  await expect(page.getByRole("heading", { name: "Подарки", exact: true })).toBeVisible();
  await expect(page.locator("article")).toHaveCount(1);
  await expect(page.getByText(F.COL19_LIVE_NAME).first()).toBeVisible();
  await expect(page.getByText(F.COL19_SOLD_NAME)).toHaveCount(0);
  await expect(page.getByText(F.COL19_OFF_NAME)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("подборка: все товары удалены — страница пустая, с noindex; чужой код — 404", async ({
  page,
  request,
}) => {
  const errors = await watch(page);
  await page.goto(`/s/${F.COL19_SHOP_SLUG}/col/${F.COL19_EMPTY_CODE}`);
  await expect(page.getByText("нет товаров в наличии", { exact: false })).toBeVisible();
  const html = await (
    await request.get(`/s/${F.COL19_SHOP_SLUG}/col/${F.COL19_EMPTY_CODE}`)
  ).text();
  expect(html).toContain('content="noindex,follow"');
  expect((await request.get(`/s/${F.COL19_SHOP_SLUG}/col/zzzz9999`)).status()).toBe(404);
  expect(errors).toEqual([]);
});
