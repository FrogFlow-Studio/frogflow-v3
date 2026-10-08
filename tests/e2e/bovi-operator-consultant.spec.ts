import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * BOVI, партия 10: оператор видит консультанта по прайсу (модель, ошибки,
 * прайс, курс) и выбирает модель из проверенного списка.
 */
test("оператор: консультант по прайсу и выбор модели", async ({ page }, info) => {
  const errors = await watch(page);
  await page.goto("/operator/login");
  await page.locator('input[name="username"]').fill(F.OPERATOR_LOGIN);
  await page.locator('input[name="password"]').fill(F.OPERATOR_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/operator$/);

  await page.goto(`/operator/clients/${F.BOVI_PLAN_ID}`);
  await expect(page.getByText("Консультант по прайсу", { exact: true })).toBeVisible();
  // Проекты (компьютер, телефон) делят одну подставную базу: модель меняет только
  // компьютер и возвращает её назад, телефон смотрит карточку.
  if (info.project.name !== "desktop") {
    expect(errors).toEqual([]);
    return;
  }
  const model = page.getByRole("combobox", { name: "Модель", exact: true });
  const save = page.getByRole("button", { name: "Сохранить модель", exact: true });
  await model.selectOption("claude-sonnet-5");
  await save.click();
  await expect(page.getByText("Отвечает на claude-sonnet-5.", { exact: true })).toBeVisible();
  await model.selectOption("");
  await save.click();
  await expect(page.getByText("(модель платформы)")).toBeVisible();
  expect(errors).toEqual([]);
});
