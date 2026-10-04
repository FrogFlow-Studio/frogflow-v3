import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Журнал склада (магазин «Склад С8»): движения постранично («Показать ещё»), фильтр по причине,
 * ссылка на CSV.
 */
test("журнал склада: страницы, фильтр по причине, CSV", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.JRN18_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.JRN18_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/admin/warehouse/journal");
  await expect(page.getByRole("heading", { name: "Журнал склада", exact: true })).toBeVisible();
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(50);
  await page.getByRole("button", { name: "Показать ещё", exact: true }).click();
  await expect(rows).toHaveCount(F.JRN18_FLOUR_EVENTS + 1);
  await expect(page.getByRole("button", { name: "Показать ещё", exact: true })).toHaveCount(0);

  await page.locator("select").filter({ hasText: "Любая причина" }).selectOption("receipt");
  await page.getByRole("button", { name: "Показать", exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(F.JRN18_SUGAR_NAME);
  await expect(rows.first()).toContainText("Приход №7");

  await expect(page.getByRole("link", { name: "Скачать CSV", exact: true })).toHaveAttribute(
    "href",
    /\/api\/admin\/export\/stock-journal\?.*reason=receipt/,
  );
  expect(errors).toEqual([]);
});
