import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** «Тексты бота» (Б8): продавец-владелец сохраняет приветствие, видит предпросмотр и сбрасывает к стандартному. */
test("тексты бота: свой текст сохраняется, виден в предпросмотре бота и сбрасывается", async ({
  page,
}) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/admin/bot-texts");
  await expect(page.getByRole("heading", { name: "Тексты бота", exact: true })).toBeVisible();
  const welcome = page.locator("section", { hasText: "Приветствие" }).first();
  await welcome.locator("textarea").fill("Добро пожаловать в {shop}, e2e-текст");
  await expect(welcome.getByText(`Добро пожаловать в ${F.SHOP_NAME}, e2e-текст`)).toBeVisible();
  await welcome.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(welcome.getByText("Сохранено", { exact: true })).toBeVisible();

  await page.goto("/admin/bot-preview");
  await expect(page.getByText(`Добро пожаловать в ${F.SHOP_NAME}, e2e-текст`)).toBeVisible();

  await page.goto("/admin/bot-texts");
  const again = page.locator("section", { hasText: "Приветствие" }).first();
  await again.getByRole("button", { name: "Вернуть стандартный", exact: true }).click();
  await expect(
    again.getByRole("button", { name: "Вернуть стандартный", exact: true }),
  ).toBeDisabled();
  await page.goto("/admin/bot-preview");
  await expect(page.locator("strong", { hasText: F.SHOP_NAME })).toBeVisible();
  expect(errors).toEqual([]);
});
