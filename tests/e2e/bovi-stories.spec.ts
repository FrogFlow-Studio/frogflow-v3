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

test("страница консультанта по прайсу: база знаний — ссылкой, длинный тег свёрнут", async ({
  page,
}) => {
  const errors = await watch(page);
  await login(page);
  await page.goto("/admin/consultant");
  await expect(page.getByText(/база знаний \(статей: 2\)/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Открыть «Прайс консультанта»", exact: true }),
  ).toBeVisible();
  // Редактора документов универсального консультанта нет — он здесь не работает.
  await expect(page.getByRole("button", { name: "+ Документ", exact: true })).toHaveCount(0);
  // Длинные названия из прайса не раздвигают страницу на телефоне.
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  // Весь прайс доступен: 30 первых и «Показать ещё» до конца (62 позиции в сиде).
  await expect(page.getByText("Показано 30 из 62", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Показать ещё", exact: true }).click();
  await expect(page.getByText("Показано 60 из 62", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Показать ещё", exact: true }).click();
  await expect(page.getByRole("button", { name: "Показать ещё", exact: true })).toHaveCount(0);
  const tag = page.locator("li", { hasText: "instagram.com/p/DPe2eMany" });
  await expect(tag).toContainText("BOVI Наволочки 02");
  await expect(tag).not.toContainText("BOVI Наволочки 04");
  await tag.getByRole("button", { name: "ещё 2", exact: true }).click();
  await expect(tag).toContainText("BOVI Наволочки 04");
  await tag.getByRole("button", { name: "Свернуть", exact: true }).click();
  await expect(tag).not.toContainText("BOVI Наволочки 04");
  expect(errors).toEqual([]);
});
