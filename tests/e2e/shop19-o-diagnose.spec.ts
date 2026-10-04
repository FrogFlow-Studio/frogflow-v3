import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** Диагностика канала у оператора: кнопка отвечает списком «ок / не ок / что сделать», только чтение. */
test("диагностика канала: список пунктов с вердиктом", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/operator/login");
  await page.locator('input[name="username"]').fill(F.OPERATOR_LOGIN);
  await page.locator('input[name="password"]').fill(F.OPERATOR_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/operator$/);

  await page.goto(`/operator/clients/${F.SHOP_ID}?tab=channels`);
  await expect(
    page.getByRole("heading", { name: "Диагностика канала", exact: true }),
  ).toBeVisible();
  for (const ch of ["Telegram", "Instagram", "WhatsApp"]) {
    await expect(page.getByRole("button", { name: `Проверить ${ch}`, exact: true })).toBeVisible();
  }

  await page.getByRole("button", { name: "Проверить Instagram", exact: true }).click();
  const card = page.locator("section.card", { hasText: "Диагностика канала" });
  // Вердикт и хотя бы один пункт списка; у «не ок» есть «Что сделать».
  await expect(card.getByText(/^(всё в порядке|есть проблема)$/)).toBeVisible();
  await expect(card.getByText("Ключ Zernio", { exact: true })).toBeVisible();
  if (await card.getByText("есть проблема", { exact: true }).isVisible())
    await expect(card.getByText(/^Что сделать:/).first()).toBeVisible();

  await page.getByRole("button", { name: "Проверить Telegram", exact: true }).click();
  await expect(card.getByText("Токен бота", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
