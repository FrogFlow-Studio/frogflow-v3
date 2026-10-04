import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Залежавшийся товар (магазин «Склад С18»): отчёт показывает только товары без продаж
 * с суммой «заморожено», а «Создать акцию» открывает «Скидки» с очередью выбранных товаров.
 */
test("залежавшийся товар: отчёт и переход к акции", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.STALE18_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.STALE18_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/admin/warehouse/stale");
  await expect(
    page.getByRole("heading", { name: "Залежавшийся товар", exact: true }),
  ).toBeVisible();
  for (const n of F.STALE18_PRODUCT_NAMES)
    await expect(page.getByRole("link", { name: n, exact: true })).toBeVisible();
  // Продан на днях — не залежался.
  await expect(
    page.getByRole("link", { name: F.STALE18_SOLD_PRODUCT_NAME, exact: true }),
  ).toHaveCount(0);
  // 10 × 500 + 4 × 600 = 7400; у «Шкатулки» себестоимости нет — в сумму не входит.
  await expect(page.getByText(/Залежалось товаров: 3\./)).toContainText(/7\s?400/);
  await expect(page.getByText(/без себестоимости \(1\)/)).toBeVisible();

  const create = page.getByRole("button", { name: "Создать акцию", exact: true });
  await expect(create).toBeDisabled();
  await page.getByLabel(`Выбрать «${F.STALE18_PRODUCT_NAMES[0]}»`, { exact: true }).check();
  await page.getByLabel(`Выбрать «${F.STALE18_PRODUCT_NAMES[1]}»`, { exact: true }).check();
  await create.click();

  await expect(page).toHaveURL(/\/admin\/discounts\?offerProducts=/);
  await expect(page.getByText(/осталось создать акций — 2/)).toBeVisible();
  await expect(page.getByText(F.STALE18_PRODUCT_NAMES[0]!, { exact: false }).first()).toBeVisible();
  expect(errors).toEqual([]);
});
