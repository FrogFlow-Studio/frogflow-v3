import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

test("список клиентов: таблица, состояния и фильтры в адресе", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/operator/login");
  await page.locator('input[name="username"]').fill(F.OPERATOR_LOGIN);
  await page.locator('input[name="password"]').fill(F.OPERATOR_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/operator$/);
  await page.goto("/operator/clients");
  const all = await page.locator(".operator-client-record").count();
  expect(all).toBeGreaterThan(0);
  // Таблица: показатели в колонках, без раскрытия (на телефоне шапка скрыта — строки карточками).
  await expect(page.locator("thead th", { hasText: /^Заказов за 30 дней$/ })).toBeAttached();
  await expect(page.locator("thead th", { hasText: /^Оплачено$/ })).toBeAttached();
  for (const name of [/Нужна помощь/, /Оплата скоро/]) {
    await page.getByRole("button", { name }).click();
    expect(await page.locator(".operator-client-record").count()).toBeLessThanOrEqual(all);
    await page.reload();
    await expect(page.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
  }
  await page.getByRole("button", { name: /Все клиенты/ }).click();
  await expect(page.locator(".operator-client-record")).toHaveCount(all);
  expect(errors).toEqual([]);
});
