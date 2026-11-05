import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Раздел без подключённого модуля: вместо ошибки 500 или молчаливого
 * переброса на «Обзор» — страница «не подключён» с ценой и дорогой в «Модули».
 */

async function login(page: import("@playwright/test").Page) {
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test("модуль не на тарифе: склад и рассылки — понятная страница, без ошибки", async ({ page }) => {
  const errors = await watch(page);
  await login(page);
  for (const [path, module] of [
    ["/admin/warehouse", "warehouse"],
    ["/admin/broadcasts", "broadcasts"],
  ] as const) {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`/admin/locked/${module}$`));
    await expect(page.getByRole("heading", { name: /не подключён/ })).toBeVisible();
    await expect(page.getByText(/Модуль .* не подключён к вашему тарифу/)).toHaveCount(0);
  }
  await page.getByRole("link", { name: "Открыть «Модули»", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/modules$/);
  expect(errors).toEqual([]);
});

test("консультант по прайсу выключен: база знаний ведёт на подсказку про оператора", async ({
  page,
}) => {
  const errors = await watch(page);
  await login(page);
  await page.goto("/admin/knowledge");
  await expect(page).toHaveURL(/\/admin\/locked\/pricelist$/);
  await expect(
    page.getByRole("heading", { name: "Консультант по прайсу не включён", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("link", { name: "Написать в поддержку", exact: true })
      .filter({ hasText: "Написать в поддержку" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
