import { expect, test } from "@playwright/test";
import { watch } from "./helpers.ts";

/** К3: «Заказать снова» есть только у вошедшего покупателя площадки; без входа страница пуста и не уезжает вбок. */
test("«Мои заказы» площадки без входа: кнопки «Заказать снова» нет, телефон без прокрутки", async ({
  page,
}) => {
  const errors = await watch(page);
  await page.goto("/market/account");
  await expect(page.getByText("Войдите через любой магазин площадки")).toBeVisible();
  await expect(page.getByRole("button", { name: "Заказать снова", exact: true })).toHaveCount(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});
