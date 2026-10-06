import { expect, test, type Page } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Жалоба BOVI 29.09: товары для публикации Instagram брались не из прайса,
 * который знает консультант, и новинок в списке не было.
 */
async function login(page: Page) {
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.BOVI_E2E_LOGIN);
  await page.locator('input[name="password"]').fill(F.BOVI_E2E_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test("тег публикации: новинка из прайса находится и сохраняется с ценой", async ({ page }) => {
  const errors = await watch(page);
  await login(page);
  await page.goto("/admin/consultant");
  const search = page.getByPlaceholder("Найти товар в прайсе консультанта", { exact: true });
  await search.fill("корзина для белья");
  const newItem = page.getByRole("button", { name: new RegExp(`^${F.BOVI_E2E_NEW_ITEM}`) });
  await expect(newItem).toBeVisible();
  await expect(page.getByText(F.BOVI_E2E_CATALOG_ITEM, { exact: true })).toHaveCount(0);
  await newItem.click();
  await page
    .getByPlaceholder("Ссылка на сторис, рилс или пост", { exact: true })
    .fill("https://www.instagram.com/p/DPe2eBovi/");
  await page.getByRole("button", { name: "Добавить тег", exact: true }).click();
  const saved = page.locator("li", { hasText: "instagram.com/p/DPe2eBovi" });
  await expect(saved).toContainText(F.BOVI_E2E_NEW_ITEM);
  await expect(saved).toContainText("74");
  expect(errors).toEqual([]);
});
