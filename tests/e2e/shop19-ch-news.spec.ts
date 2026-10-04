import { expect, test, type Page } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** Лента новостей (Ч5): оператор пишет и публикует, продавец видит в «Что нового». */
async function operatorLogin(page: Page) {
  await page.goto("/operator/login");
  await page.locator('input[name="username"]').fill(F.OPERATOR_LOGIN);
  await page.locator('input[name="password"]').fill(F.OPERATOR_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/operator$/);
}

test("новости: черновик не виден продавцу, после публикации виден", async ({ browser }, info) => {
  const title = `Новая возможность ${info.project.name} ${Date.now()}`;
  const opCtx = await browser.newContext();
  const op = await opCtx.newPage();
  const opErrors = await watch(op);
  await operatorLogin(op);
  await op.goto("/operator/news");
  await op.getByLabel("Заголовок Русский", { exact: true }).fill(title);
  await op.getByLabel("Текст Русский", { exact: true }).fill("Теперь можно включить розыгрыши.");
  await op.getByRole("button", { name: "Сохранить черновик", exact: true }).click();
  await expect(op.getByText(title, { exact: true })).toBeVisible();
  await expect(op.getByText("черновик", { exact: true }).first()).toBeVisible();

  const sellerCtx = await browser.newContext();
  const seller = await sellerCtx.newPage();
  const sellerErrors = await watch(seller);
  await seller.goto("/admin/login");
  await seller.locator('input[name="username"]').fill(F.SELLER_LOGIN);
  await seller.locator('input[name="password"]').fill(F.SELLER_PASSWORD);
  await seller.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(seller).toHaveURL(/\/admin$/);
  await seller.goto("/admin/news");
  await expect(seller.getByRole("heading", { name: "Что нового", exact: true })).toBeVisible();
  await expect(seller.getByText(title, { exact: true })).toHaveCount(0);

  op.once("dialog", (d) => void d.accept());
  const row = op.getByRole("listitem").filter({ hasText: title });
  await row.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(row.getByText("опубликовано", { exact: true })).toBeVisible();

  await seller.reload();
  await expect(seller.getByRole("heading", { name: title, exact: true })).toBeVisible();
  expect(sellerErrors).toEqual([]);
  expect(opErrors).toEqual([]);
  await opCtx.close();
  await sellerCtx.close();
});
