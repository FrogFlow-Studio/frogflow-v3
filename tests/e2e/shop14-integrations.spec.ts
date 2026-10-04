import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** Журнал доставки вебхуков на странице настроек: отправки видны, тела и секрета нет. */
test("интеграции: журнал доставки вебхуков показывает ответы адресата", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.INT14_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.INT14_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/settings");
  const log = page.getByTestId("crm-log");
  await expect(log.getByText("Журнал доставки", { exact: true })).toBeVisible();
  await expect(log.getByText("принято (200)")).toBeVisible();
  await expect(log.getByText("отказ: код 500")).toBeVisible();
  await expect(log.getByText("таймаут: сервер не ответил за 10 секунд")).toBeVisible();
  await expect(log.getByText("#9101")).toHaveCount(2);
  await expect(log).not.toContainText("e2e-secret");
  expect(errors).toEqual([]);
});
