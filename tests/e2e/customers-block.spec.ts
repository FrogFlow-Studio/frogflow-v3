import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * «Заблокировать» в «Покупателях» работает и для покупателя из Instagram:
 * раньше кнопка была выключена для всех, кроме Telegram, хотя Instagram-бот
 * блокировку уже проверял (жалоба клиентки 23.11.2026).
 */
test("покупательницу из Instagram можно заблокировать и разблокировать", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.CB_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.CB_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/admin/customers");
  const row = page.locator("main tbody tr", { hasText: F.CB_IG_NAME });
  await expect(row).toContainText("instagram");
  const block = row.getByRole("button", { name: "Заблокировать", exact: true });
  await expect(block).toBeEnabled();
  await block.click();
  await expect(row.getByText("заблокирован", { exact: true })).toBeVisible();
  const unblock = row.getByRole("button", { name: "Разблокировать", exact: true });
  await expect(unblock).toBeEnabled();

  // После перезагрузки блок на месте: он записан, а не только нарисован.
  await page.reload();
  await expect(
    page
      .locator("main tbody tr", { hasText: F.CB_IG_NAME })
      .getByText("заблокирован", { exact: true }),
  ).toBeVisible();

  await page
    .locator("main tbody tr", { hasText: F.CB_IG_NAME })
    .getByRole("button", { name: "Разблокировать", exact: true })
    .click();
  await expect(
    page
      .locator("main tbody tr", { hasText: F.CB_IG_NAME })
      .getByRole("button", { name: "Заблокировать", exact: true }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});
