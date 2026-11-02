import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** А2: главная «Что сделать сегодня» — задачи сверху, сначала дела, выручка без повторов, без горизонтальной прокрутки. */
test("главная: задачи дня и выручка", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await expect(
    page.getByRole("heading", { name: "Что сделать сегодня", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Выручка за неделю", { exact: true })).toBeVisible();
  // Сначала дела, потом цифры: задачи выше «Продаж сегодня»; выручка за сутки и за 30 дней
  // не повторяет «Продажи сегодня» и «Рост».
  const todo = await page
    .getByRole("heading", { name: "Что сделать сегодня", exact: true })
    .boundingBox();
  const pace = await page.getByText("Продажи сегодня", { exact: true }).first().boundingBox();
  expect(todo!.y).toBeLessThan(pace!.y);
  await expect(page.getByText("Выручка за сутки", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Выручка за 30 дней", { exact: true })).toHaveCount(0);

  // Каждая задача — ссылка в нужный фильтр.
  const receipts = page.getByRole("link", { name: /^Чеки на проверке/ });
  if (await receipts.count()) {
    await receipts.click();
    await expect(page).toHaveURL(/\/admin\/orders\?status=awaiting_confirmation/);
  }
  await page.goto("/admin");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});
