import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Х3: роль «Администратор» — владелец зовёт по ссылке; администратор видит настройки и
 * журнал, но не тариф, не комиссию и не историю оплат.
 */
test("приглашение администратора: настройки есть, платежей и тарифа нет", async ({
  page,
  browser,
  baseURL,
}, info) => {
  const login = `e2e_admin22_${info.project.name}`;
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.TEAM19_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.TEAM19_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/settings");
  await page.getByRole("button", { name: "Все", exact: true }).click();
  await expect(async () => {
    await page.getByRole("button", { name: "Пригласить по ссылке", exact: true }).click();
    await expect(page.locator('select[name="role"]').first()).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 25_000 });
  await page.locator('select[name="role"]').first().selectOption("admin");
  await page.locator('input[name="name"]').first().fill("Админ");
  await page.getByRole("button", { name: "Создать ссылку", exact: true }).click();
  const link = await page.locator("input[readonly]").inputValue();

  const guest = await browser.newContext({ baseURL });
  const gp = await guest.newPage();
  await gp.goto(link);
  await gp.locator('input[name="username"]').fill(login);
  await gp.locator('input[name="password"]').fill("admin-pass-12345");
  await gp.getByRole("button", { name: "Принять и создать вход", exact: true }).click();
  await expect(
    gp.getByText("Готово. Теперь войдите под своим логином.", { exact: true }),
  ).toBeVisible();
  await gp.getByRole("link", { name: "Войти", exact: true }).click();
  await gp.locator('input[name="username"]').fill(login);
  await gp.locator('input[name="password"]').fill("admin-pass-12345");
  await gp.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(gp).toHaveURL(/\/admin$/);
  // Настройки и журнал открыты; тариф, комиссия и история оплат — нет.
  await expect(gp.locator('a[href="/admin/settings"]').first()).toBeAttached();
  await expect(gp.locator('a[href="/admin/log"]').first()).toBeAttached();
  for (const href of ["/admin/billing", "/admin/commission", "/admin/ai-balance", "/admin/modules"])
    await expect(gp.locator(`a[href="${href}"]`)).toHaveCount(0);
  await guest.close();
  expect(errors).toEqual([]);
});
