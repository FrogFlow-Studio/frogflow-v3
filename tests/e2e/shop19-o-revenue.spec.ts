import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** Выручка оператора: график поступлений, продления на 14 дней, отток. */
test("выручка оператора: график, таблица по тарифам, продления и отток", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/operator/login");
  await page.locator('input[name="username"]').fill(F.OPERATOR_LOGIN);
  await page.locator('input[name="password"]').fill(F.OPERATOR_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/operator$/);

  await page.goto("/operator/revenue");
  const cash = page.locator("section.card", { hasText: "Поступления по месяцам и тарифам" });
  await expect(cash.locator("svg").first()).toBeVisible();
  await cash.getByRole("button", { name: "Таблица", exact: true }).click();
  for (const h of ["Месяц", "Basic", "Pro", "Business", "Другое", "Всего"]) {
    await expect(cash.locator("th", { hasText: new RegExp(`^${h}$`) })).toBeVisible();
  }
  await cash.getByRole("button", { name: "График", exact: true }).click();
  await expect(cash.locator("svg").first()).toBeVisible();

  await expect(
    page.getByRole("heading", { name: "Продления в ближайшие 14 дней", exact: true }),
  ).toBeVisible();
  const churn = page.locator("section.card", { hasText: "Отток за 30 дней" });
  await expect(churn.getByText("MRR ушёл", { exact: true })).toBeVisible();
  await expect(churn.getByText("Доля", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
