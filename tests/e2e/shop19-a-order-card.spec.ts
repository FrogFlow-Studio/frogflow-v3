import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** А4 → З2: карточка заказа — шаги статуса и главная кнопка наверху, прочие действия под «Ещё», история одной лентой. */
test("карточка заказа: шаги, главная кнопка и «Ещё», история лентой", async ({ page }, info) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.ORD19_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.ORD19_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  // Чек на проверке: главная кнопка — подтвердить; отклонить спрятано под «Ещё».
  await page.goto(`/admin/orders/${F.ORD19_ORDERS[0][0]}`);
  const confirm = page.getByRole("button", { name: "✅ Подтвердить и выдать", exact: true });
  await expect(confirm).toBeVisible();
  await expect(page.getByRole("list", { name: "Шаги заказа", exact: true })).toBeVisible();
  await page.locator("summary", { hasText: "Ещё" }).click();
  await expect(page.getByRole("button", { name: "Отклонить", exact: true })).toBeVisible();

  // История — одной лентой на той же странице, без вкладок.
  await expect(page.getByRole("heading", { name: "История", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "История", exact: true })).toHaveCount(0);

  // Панель действий липкая в колонке заказа (компьютер): после прокрутки кнопка в окне.
  if (info.project.name !== "phone") {
    await page.getByTestId("order-detail").evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(confirm).toBeInViewport();
  }

  // Выданный заказ: допустимых переходов нет, главной кнопки нет.
  await page.goto(`/admin/orders/${F.ORD19_ORDERS[2][0]}`);
  await expect(page.getByRole("heading", { name: /Заказ #3/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Отклонить", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("order-main-action")).toHaveCount(0);
  expect(errors).toEqual([]);
});
