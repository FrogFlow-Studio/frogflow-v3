import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** А4: карточка заказа — панель действий сверху остаётся на виду, кнопки только допустимых переходов, история рядом/вкладкой. */
test("карточка заказа: действия наверху, история вкладкой на телефоне", async ({ page }, info) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.ORD19_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.ORD19_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  // Чек на проверке: можно подтвердить и отклонить.
  await page.goto(`/admin/orders/${F.ORD19_ORDERS[0][0]}`);
  const confirm = page.getByRole("button", { name: "✅ Подтвердить и выдать", exact: true });
  await expect(confirm).toBeVisible();
  await expect(page.getByRole("button", { name: "Отклонить", exact: true })).toBeVisible();

  const phone = info.project.name === "phone";
  const events = page.getByText("Событий пока нет.", { exact: true });
  if (phone) {
    await expect(events).toBeHidden();
    await page.getByRole("tab", { name: "История", exact: true }).click();
    await expect(events).toBeVisible();
    await page.getByRole("tab", { name: "Заказ", exact: true }).click();
    await expect(events).toBeHidden();
  } else {
    await expect(events).toBeVisible();
  }

  // Панель действий липкая: после прокрутки кнопка всё ещё в окне.
  await page
    .locator("div.overflow-y-auto")
    .first()
    .evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(confirm).toBeInViewport();

  // Выданный заказ: допустимых переходов нет.
  await page.goto(`/admin/orders/${F.ORD19_ORDERS[2][0]}`);
  await expect(page.getByRole("heading", { name: /Заказ #3/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Отклонить", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "✅ Подтвердить и выдать", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
