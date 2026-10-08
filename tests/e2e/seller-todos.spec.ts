import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** А3: свои задачи продавца в «Что сделать сегодня» — добавить, отметить, удалить. */
test("главная: свои задачи на сегодня", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await expect(
    page.getByText("Заказы и остатки появляются здесь сами; свои дела можно добавить ниже.", {
      exact: true,
    }),
  ).toBeVisible();
  const text = `Выложить Reels ${Date.now()}`;
  await page.getByRole("textbox", { name: "Добавить задачу…", exact: true }).fill(text);
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  const item = page.getByRole("listitem").filter({ hasText: text });
  await expect(item).toBeVisible();

  // После перезагрузки задача на месте: она записана, а не только в памяти страницы.
  await page.reload();
  await expect(item).toBeVisible();

  // Отмеченная уходит в свёрнутое «Сделано (N)» (N общий: телефон и компьютер идут параллельно).
  await item.getByRole("checkbox", { name: "Отметить сделанной", exact: true }).click();
  await expect(page.getByText(/^Сделано \(\d+\)$/)).toBeVisible();
  await page.getByText(/^Сделано \(\d+\)$/).click();
  await expect(item.getByRole("checkbox", { name: "Вернуть в работу", exact: true })).toBeChecked();
  await item.getByRole("button", { name: "Удалить задачу", exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: text })).toHaveCount(0);
  expect(errors).toEqual([]);
});
