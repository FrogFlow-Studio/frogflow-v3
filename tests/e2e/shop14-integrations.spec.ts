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
  await expect(page.getByTestId("api-last-use")).toContainText("203.0.113.7 · 1C-Connector/8.3");
  await expect(log.getByText("Журнал доставки", { exact: true })).toBeVisible();
  await expect(log.getByText("принято (200)")).toBeVisible();
  await expect(log.getByText("отказ: код 500")).toBeVisible();
  await expect(log.getByText("таймаут: сервер не ответил за 10 секунд")).toBeVisible();
  await expect(log.getByText("#9101")).toHaveCount(2);
  await expect(log).not.toContainText("e2e-secret");
  // Упавшее событие повторяется вручную кнопкой из журнала; принятое и без outbox — без кнопки.
  await expect(log.getByRole("button", { name: "Повторить", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Проверить вебхук", exact: true })).toBeEnabled();
  // Стенд общий для обоих окон: строку очереди ставим на повтор один раз.
  if (test.info().project.name === "desktop") {
    await log.getByRole("button", { name: "Повторить", exact: true }).click();
    await expect(
      page.getByText("Событие поставлено на повтор: уйдёт в ближайшую минуту."),
    ).toBeVisible();
  }
  expect(errors).toEqual([]);
});
