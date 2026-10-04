import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** А2: главная «Что сделать сегодня» — задачи сверху, выручка за сутки и неделю, без горизонтальной прокрутки. */
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
  await expect(page.getByText("Выручка за сутки", { exact: true })).toBeVisible();
  await expect(page.getByText("Выручка за неделю", { exact: true })).toBeVisible();

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
