import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** Мастер подключения канала: шаг и подсказка при сбое видны продавцу на странице настроек. */
test("мастер канала: на шаге «проверка связи» написано, что делать, и есть «Проверить»", async ({
  page,
}) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.P5_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.P5_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/settings");
  await expect(page.getByText("Подключение Instagram по шагам", { exact: true })).toBeVisible();
  await expect(page.getByText("2. Проверка связи", { exact: true })).toBeVisible();
  await expect(page.getByText(/Связь платформы с вашим аккаунтом ещё не включена/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Проверить", exact: true })).toBeEnabled();
  // Вход уже пройден: кнопки «Войти в Instagram» на этом шаге нет.
  await expect(page.getByRole("button", { name: "Войти в Instagram", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
