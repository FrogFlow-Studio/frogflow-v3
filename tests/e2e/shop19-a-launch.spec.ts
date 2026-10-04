import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** А11: «Запуск магазина» на главной — процент готовности, шаг скрывается и возвращается. */
test("главная: запуск магазина с процентом и скрытием шага", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await expect(page.getByText(/^Запуск магазина · готово на \d+%$/)).toBeVisible();
  const skip = page.locator("li").getByRole("button", { name: "Скрыть", exact: true });
  const before = await skip.count();
  await skip.first().click();
  await expect(page.locator("li").getByRole("button", { name: "Скрыть", exact: true })).toHaveCount(
    before - 1,
  );
  await page.getByRole("button", { name: /· Вернуть$/ }).click();
  await expect(page.locator("li").getByRole("button", { name: "Скрыть", exact: true })).toHaveCount(
    before,
  );
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});
