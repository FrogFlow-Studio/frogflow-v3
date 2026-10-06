import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * BOVI 06.10: у консультанта без плана список тарифов показывал «Индивидуальный»,
 * а форма отправляла невидимый «basic» — «Сохранить план» отвечал ошибкой.
 */
test("консультант без тарифов: «Индивидуальный» сохраняется", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/operator/login");
  await page.locator('input[name="username"]').fill(F.OPERATOR_LOGIN);
  await page.locator('input[name="password"]').fill(F.OPERATOR_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/operator$/);

  await page.goto(`/operator/clients/${F.BOVI_PLAN_ID}?tab=billing`);
  const plan = page.getByRole("combobox", { name: "План", exact: true });
  await expect(plan).toHaveValue("custom");
  await expect(page.getByText("Instagram сверх плана")).toHaveCount(0);

  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Сохранить план", exact: true }).click();
  await expect(page.getByText("План сохранён, модули пересчитаны.")).toBeVisible();
  await expect(
    page.getByText("У этой ниши нет тарифов (консультант BOVI — по договору): выберите"),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
