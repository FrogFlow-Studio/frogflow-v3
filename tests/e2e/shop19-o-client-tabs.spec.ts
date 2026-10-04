import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** Карточка клиента у оператора: вкладки и подтверждение опасного действия вводом названия. */
test("карточка клиента: вкладки и архивирование только после ввода названия", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/operator/login");
  await page.locator('input[name="username"]').fill(F.OPERATOR_LOGIN);
  await page.locator('input[name="password"]').fill(F.OPERATOR_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/operator$/);

  await page.goto(`/operator/clients/${F.SHOP_ID}`);
  const tabs = page.getByRole("navigation", { name: "Разделы клиента" });
  for (const t of ["Обзор", "Каналы", "Оплата", "Журнал", "Переезд"]) {
    await expect(tabs.getByRole("link", { name: t, exact: true })).toBeVisible();
  }
  // Обзор: цифры и доступ; оплаты и каналов здесь нет.
  await expect(page.getByText("Заказов за 30 дней", { exact: true })).toBeVisible();
  await expect(page.getByText("Выставить счёт владельцу")).toHaveCount(0);

  await tabs.getByRole("link", { name: "Каналы", exact: true }).click();
  await expect(page).toHaveURL(/tab=channels/);
  await expect(page.getByRole("heading", { name: "Telegram", exact: true })).toBeVisible();

  await tabs.getByRole("link", { name: "Оплата", exact: true }).click();
  await expect(page.locator("form", { hasText: "Выставить счёт владельцу" })).toBeVisible();

  await tabs.getByRole("link", { name: "Журнал", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Журнал", exact: true })).toBeVisible();

  await tabs.getByRole("link", { name: "Переезд", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Переезд на v2", exact: true })).toBeVisible();

  // Архивирование: кнопка включается только после ввода названия; отменяем — клиент остаётся.
  const name = ((await page.getByRole("heading", { level: 1 }).textContent()) ?? "")
    .replace(/\s*(активен|пауза|приостановлен)\s*$/, "")
    .trim();
  expect(name.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Архивировать", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Архивировать клиента?" });
  const go = dialog.getByRole("button", { name: "Архивировать", exact: true });
  await expect(go).toBeDisabled();
  await dialog.getByLabel("Название клиента для подтверждения").fill("не то название");
  await expect(go).toBeDisabled();
  await dialog.getByLabel("Название клиента для подтверждения").fill(name);
  await expect(go).toBeEnabled();
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/operator/clients/${F.SHOP_ID}`));
  expect(errors).toEqual([]);
});
