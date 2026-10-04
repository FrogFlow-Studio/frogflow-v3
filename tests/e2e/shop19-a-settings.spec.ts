import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** А13: настройки по темам и поиск по названию. */
test("настройки: темы, поиск, ссылка на отдельную страницу", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/settings");

  const section = (id: string) => page.locator(`[data-settings-section="${id}"]`);
  await expect(section("telegram")).toBeVisible();
  await expect(section("shop")).toBeVisible();

  // Поиск по названию: остаётся только найденное.
  const search = page.getByRole("searchbox", { name: "Найти настройку по названию", exact: true });
  await search.fill("telegram");
  await expect(section("telegram")).toBeVisible();
  await expect(section("shop")).toBeHidden();

  // Поиск по названию поля внутри раздела.
  await search.fill("часовой пояс");
  await expect(section("shop")).toBeVisible();
  await expect(section("telegram")).toBeHidden();

  await search.fill("такого-нет-нигде");
  await expect(page.getByText(/^Ничего не найдено/)).toBeVisible();

  // Раздел с отдельной страницы — ссылкой «Открыть».
  await search.fill("консультант");
  await page.getByRole("link", { name: "Открыть", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/consultant/);

  // Тема.
  await page.goto("/admin/settings");
  await page.getByRole("button", { name: "Оплата и доставка", exact: true }).click();
  await expect(section("zones")).toBeVisible();
  await expect(section("telegram")).toBeHidden();
  await page.getByRole("button", { name: "Все", exact: true }).click();
  await expect(section("telegram")).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});
