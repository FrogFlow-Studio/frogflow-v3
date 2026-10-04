import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Перенос даты заказа в админке («Пекарня В15»): нерабочий и занятый день — предупреждение
 * продавцу, как в ручном заказе; свободный день и текущая дата заказа — без предупреждения.
 */
test("админка: перенос даты заказа на нерабочий или занятый день — предупреждение", async ({
  page,
}) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.RESCHED15_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.RESCHED15_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto(`/admin/orders/${F.RESCHED15_ORDER_ID}`);
  await page.getByRole("button", { name: "Изменить", exact: true }).click();
  const at = page.locator('input[name="at"]');
  const closedWarn = page.getByText("В этот день выдачи нет по настройкам магазина.");
  const fullWarn = page.getByText("На эту дату заказы уже набраны по лимиту.");

  await expect(fullWarn).toHaveCount(0);
  await at.fill(F.reschedClosedDay());
  await expect(closedWarn).toBeVisible();
  await at.fill(F.reschedBusyDay());
  await expect(fullWarn).toBeVisible();
  await expect(closedWarn).toHaveCount(0);
  await at.fill(F.reschedFreeDay());
  await expect(closedWarn).toHaveCount(0);
  await expect(fullWarn).toHaveCount(0);
  // Текущая дата заказа сама «занята» своим заказом, но это не перенос — без предупреждения.
  await at.fill(F.reschedOrderDay());
  await expect(fullWarn).toHaveCount(0);
  expect(errors).toEqual([]);
});
