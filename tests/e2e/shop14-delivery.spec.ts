import { expect, test, type Page } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Выдача заказов с сайта (магазин «Пекарня Д14»): воскресенье — без выдачи.
 * Форма называет нерабочий день и не даёт выбрать его; ближайший рабочий день
 * проходит, заказ ложится в магазин.
 */

/** Ближайшая дата с днём недели `dow` (0 — воскресенье) не раньше чем через 3 дня, YYYY-MM-DD. */
function nextDow(dow: number, from = 3): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + from);
  while (d.getUTCDay() !== dow) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function openCheckout(page: Page) {
  await page.goto(`/s/${F.DELIVERY_SHOP_SLUG}`);
  await page.getByRole("button", { name: "В корзину" }).first().click();
  await page.goto(`/s/${F.DELIVERY_SHOP_SLUG}/cart`);
  await page.getByRole("link", { name: "Оформить на сайте" }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${F.DELIVERY_SHOP_SLUG}/checkout$`));
}

test("витрина: в нерабочий день выдачи нет — форма это говорит и не принимает дату", async ({
  page,
  request,
}, info) => {
  const errors = await watch(page);
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `10.1.${info.project.name === "phone" ? 2 : 1}.${Date.now() % 250}`,
  });
  await openCheckout(page);

  await expect(page.getByText("Выдачи нет: вс.")).toBeVisible();

  const date = page.locator('input[name="date"]');
  await date.fill(nextDow(0));
  await expect
    .poll(() => date.evaluate((el: HTMLInputElement) => el.validationMessage))
    .toBe("В этот день выдачи нет — выберите другую дату.");

  await date.fill(nextDow(1));
  await expect.poll(() => date.evaluate((el: HTMLInputElement) => el.validationMessage)).toBe("");

  // Рабочий день принят: заказ ложится на выбранную дату.
  const monday = nextDow(1);
  await page.locator('input[name="name"]').fill("Анна Д14");
  await page
    .locator('input[name="email"]')
    .fill(`d14-${info.project.name}-${Date.now()}@example.com`);
  await page.locator('input[name="phone"]').fill("+77001234567");
  await page.getByRole("button", { name: "Перейти к оплате" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/s/${F.DELIVERY_SHOP_SLUG}/order/\\d+\\?t=[0-9a-f]{32}$`),
    {
      timeout: 30_000,
    },
  );
  const id = Number(new URL(page.url()).pathname.split("/").pop());
  const orders = (await (await request.get(`${F.STUB}/__e2e/tables/orders`)).json()) as Array<{
    id: number;
    fulfillment_at: string | null;
  }>;
  expect(orders.find((o) => o.id === id)!.fulfillment_at).toBe(`${monday}T00:00:00Z`);
  expect(errors).toEqual([]);
});
