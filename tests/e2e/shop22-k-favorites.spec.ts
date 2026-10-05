import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** К1: сердечко у товара на площадке; без входа оно подсказывает, как войти, и ничего не сохраняет. */
test("избранное площадки: без входа сердечко подсказывает вход, телефон без прокрутки вбок", async ({
  page,
}) => {
  const errors = await watch(page);
  await page.goto("/market/search?q=медовик");
  await expect(
    page.getByRole("heading", { name: F.MARKET19_ITEMS.honey.name, exact: true }),
  ).toBeVisible();
  const heart = page.getByRole("button", { name: "В избранное", exact: true }).first();
  await expect(heart).toBeVisible();
  await heart.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Войдите через любой магазин" }),
  ).toBeVisible();
  await expect(heart).toHaveAttribute("aria-pressed", "false");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);

  // Кабинет без входа: избранного нет, подсказка про вход.
  await page.goto("/market/account");
  await expect(page.getByText("Войдите через любой магазин площадки")).toBeVisible();
  expect(errors).toEqual([]);
});
