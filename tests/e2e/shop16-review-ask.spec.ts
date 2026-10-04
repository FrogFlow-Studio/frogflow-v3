import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Просьба об оценке после выдачи: продавец меняет срок на странице «Отзывы»,
 * значение переживает перезагрузку. Только desktop: настройка общая для проектов.
 */
test("отзывы: срок просьбы об оценке сохраняется", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "настройка магазина общая для проектов");
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.REV16_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.REV16_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/admin/reviews");
  const days = page.getByLabel("Просить оценку через, дней после выдачи", { exact: true });
  await expect(days).toHaveValue("3");
  await days.fill("7");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByText("Сохранено", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByLabel("Просить оценку через, дней после выдачи", { exact: true }),
  ).toHaveValue("7");
  expect(errors).toEqual([]);
});
