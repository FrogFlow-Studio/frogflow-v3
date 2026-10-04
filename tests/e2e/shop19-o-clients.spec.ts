import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** Список клиентов оператора: таблица здоровья, фильтры «Проблемные» и «Оплата скоро». */
test("список клиентов: колонки здоровья и фильтры", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/operator/login");
  await page.locator('input[name="username"]').fill(F.OPERATOR_LOGIN);
  await page.locator('input[name="password"]').fill(F.OPERATOR_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/operator$/);

  for (const name of ["Тариф и срок", "Каналы", "Заказов / 7 дн", "Долг", "Последняя ошибка"]) {
    await expect(page.locator("thead th", { hasText: new RegExp(`^${name}$`) })).toBeVisible();
  }
  const shownText = async () => (await page.getByText(/^Показано: \d+$/).textContent()) ?? "";
  const all = Number((await shownText()).replace(/\D/g, ""));
  expect(all).toBeGreaterThan(0);

  // Фильтры сужают список и возвращаются обратно.
  const problem = page.getByLabel(/^Проблемные \(\d+\)$/);
  await problem.check();
  const onlyProblem = Number((await shownText()).replace(/\D/g, ""));
  expect(onlyProblem).toBeLessThanOrEqual(all);
  await problem.uncheck();
  const soon = page.getByLabel(/^Оплата скоро \(\d+\)$/);
  await soon.check();
  expect(Number((await shownText()).replace(/\D/g, ""))).toBeLessThanOrEqual(all);
  await soon.uncheck();
  await expect(page.getByText(`Показано: ${all}`, { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
