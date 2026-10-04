import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** Новость с действием (Ч6): «Подробнее» ведёт на выбранную страницу админки. */
test("новость с кнопкой «Подробнее» ведёт на страницу админки", async ({ browser }, info) => {
  // Два проекта (desktop и phone) идут на одной базе: у каждого свой заголовок.
  const title = `Тариф и оплата ${info.project.name} ${Date.now()}`;

  const opCtx = await browser.newContext();
  const op = await opCtx.newPage();
  const opErrors = await watch(op);
  await op.goto("/operator/login");
  await op.locator('input[name="username"]').fill(F.OPERATOR_LOGIN);
  await op.locator('input[name="password"]').fill(F.OPERATOR_PASSWORD);
  await op.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(op).toHaveURL(/\/operator$/);
  await op.goto("/operator/news");
  await op.getByLabel("Заголовок Русский", { exact: true }).fill(title);
  await op.getByLabel("Текст Русский", { exact: true }).fill("Посмотрите, как устроена оплата.");
  await op.getByLabel("Вид кнопки", { exact: true }).selectOption("link");
  await op.getByLabel("Страница", { exact: true }).selectOption("/admin/billing");
  await op.getByRole("button", { name: "Сохранить черновик", exact: true }).click();
  const row = op.getByRole("listitem").filter({ hasText: title });
  await expect(row).toBeVisible();
  op.once("dialog", (d) => void d.accept());
  await row.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(row.getByText("опубликовано", { exact: true })).toBeVisible();

  const sellerCtx = await browser.newContext();
  const seller = await sellerCtx.newPage();
  const sellerErrors = await watch(seller);
  await seller.goto("/admin/login");
  await seller.locator('input[name="username"]').fill(F.SELLER_LOGIN);
  await seller.locator('input[name="password"]').fill(F.SELLER_PASSWORD);
  await seller.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(seller).toHaveURL(/\/admin$/);
  await seller.goto("/admin/news");
  const card = seller.getByRole("article").filter({ hasText: title });
  await expect(card).toBeVisible();
  await card.getByRole("link", { name: "Подробнее", exact: true }).click();
  await expect(seller).toHaveURL(/\/admin\/billing$/);
  expect(sellerErrors).toEqual([]);
  expect(opErrors).toEqual([]);
  await opCtx.close();
  await sellerCtx.close();
});
