import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Бесплатная доставка от суммы на сайте: до порога — «осталось добрать» и платный район;
 * когда товары дошли до порога — «Доставка бесплатная» и «бесплатно» у района.
 */
test("сайт: до порога доставки подсказка «осталось», после — бесплатно", async ({ page }, info) => {
  // desktop и phone делят одну подставную базу: корзина после первого прогона уже выше порога.
  test.skip(info.project.name !== "desktop", "состояние базы общее для проектов");
  const errors = await watch(page);
  const shop = `/s/${F.FREE14_SHOP_SLUG}`;
  await page.goto(`${shop}/p/${F.FREE14_CAKE_ID}`);
  await page.getByRole("button", { name: "🛒 В корзину", exact: true }).click();
  await page.goto(`${shop}/checkout`);
  await page.getByRole("radio", { name: "Доставка", exact: true }).check();

  const hint = page.getByTestId("free-delivery-hint");
  // 2000 при пороге 3000: осталось 1 000, район платный.
  await expect(hint).toContainText("До бесплатной доставки осталось");
  await expect(hint).toContainText("1");
  await expect(
    page.getByRole("option", { name: new RegExp(`${F.FREE14_ZONE_NAME} \\(\\+`) }),
  ).toHaveCount(1);

  await page.goto(`${shop}/p/${F.FREE14_SWEET_ID}`);
  await page.getByRole("button", { name: "🛒 В корзину", exact: true }).click();
  await page.goto(`${shop}/checkout`);
  await page.getByRole("radio", { name: "Доставка", exact: true }).check();
  // 3500 ≥ 3000: бесплатно.
  await expect(hint).toContainText("Доставка бесплатная");
  await expect(page.getByRole("option", { name: `${F.FREE14_ZONE_NAME} (бесплатно)` })).toHaveCount(
    1,
  );
  expect(errors).toEqual([]);
});

test("админка: порог бесплатной доставки виден и сохраняется владельцем", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.FREE14_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.FREE14_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/settings");
  await page.getByRole("button", { name: "Все", exact: true }).click();
  const card = page.getByTestId("free-delivery-card");
  await expect(card.getByLabel("Общий порог, KZT")).toHaveValue(String(F.FREE14_THRESHOLD));
  const zone = card.getByLabel(`Порог для района «${F.FREE14_ZONE_NAME}», KZT`);
  await zone.fill("1500");
  await card.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(card.getByText("Сохранено")).toBeVisible();
  expect(errors).toEqual([]);
});
