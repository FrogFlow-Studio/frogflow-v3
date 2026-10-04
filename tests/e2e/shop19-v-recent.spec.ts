import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * В13: «Недавно смотрели» внизу каталога и сердечко на телефоне. Списки лежат
 * в браузере; исчезнувшие товары тихо не показываются.
 */
test("телефон: открытый товар виден внизу каталога в «Недавно смотрели»", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone", "только телефон");
  const errors = await watch(page);
  await page.goto(`/s/${F.SHOP_SLUG}`);
  await expect(page.getByRole("heading", { name: "Недавно смотрели", exact: true })).toHaveCount(0);

  await page.goto(`/s/${F.SHOP_SLUG}/p/${F.PRODUCT_ID}`);
  await page.getByRole("button", { name: "В избранное", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Убрать из избранного", exact: true }),
  ).toBeVisible();

  await page.goto(`/s/${F.SHOP_SLUG}`);
  const block = page.getByRole("region", { name: "Недавно смотрели", exact: true });
  await expect(block.getByRole("link", { name: new RegExp(F.PRODUCT_NAME) })).toBeVisible();
  expect(errors).toEqual([]);
});
