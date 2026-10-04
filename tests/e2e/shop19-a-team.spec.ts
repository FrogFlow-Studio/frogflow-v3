import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * А17: владелец зовёт человека по ссылке; ссылка одноразовая; менеджер входит,
 * но не видит оплату, настройки и команду; в журнале владельца — действия по человеку.
 */
test("приглашение менеджера по ссылке", async ({ page, browser, baseURL }) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.TEAM19_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.TEAM19_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/admin/settings");
  await page.getByRole("button", { name: "Пригласить по ссылке", exact: true }).click();
  await page.locator('input[name="name"]').first().fill("Анна");
  await page.getByRole("button", { name: "Создать ссылку", exact: true }).click();
  const link = await page.locator("input[readonly]").inputValue();
  expect(link).toContain("/admin/invite?b=");
  await expect(page.getByText("Ждут ответа", { exact: true })).toBeVisible();

  // Человек без сессии открывает ссылку и заводит себе вход.
  const guest = await browser.newContext({ baseURL });
  const gp = await guest.newPage();
  await gp.goto(link);
  await expect(gp.getByText(F.TEAM19_SHOP_NAME, { exact: false }).first()).toBeVisible();
  await gp.locator('input[name="username"]').fill("e2e_team19_anna");
  await gp.locator('input[name="password"]').fill("anna-pass-12345");
  await gp.getByRole("button", { name: "Принять и создать вход", exact: true }).click();
  await expect(
    gp.getByText("Готово. Теперь войдите под своим логином.", { exact: true }),
  ).toBeVisible();

  // Вторая попытка по той же ссылке — не действует.
  const again = await browser.newContext({ baseURL });
  const ap = await again.newPage();
  await ap.goto(link);
  await expect(ap.getByText("Ссылка не действует", { exact: false })).toBeVisible();
  await again.close();

  // Менеджер входит; оплаты, настроек и журнала в меню нет.
  await gp.getByRole("link", { name: "Войти", exact: true }).click();
  await gp.locator('input[name="username"]').fill("e2e_team19_anna");
  await gp.locator('input[name="password"]').fill("anna-pass-12345");
  await gp.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(gp).toHaveURL(/\/admin$/);
  await expect(gp.getByRole("link", { name: "Оплата и настройки", exact: true })).toHaveCount(0);
  await expect(gp.locator('a[href="/admin/billing"]')).toHaveCount(0);
  await expect(gp.locator('a[href="/admin/log"]')).toHaveCount(0);
  await guest.close();

  // Владелец видит приглашение принятым и журнал по человеку.
  await page.goto("/admin/log?who=e2e_team19_anna");
  await expect(
    page.getByText("принял приглашение и вошёл в команду", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
