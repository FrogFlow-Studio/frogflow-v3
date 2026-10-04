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

  // Занятый день (лимит заказов на день): форма тоже не даёт его выбрать.
  await date.fill(F.deliveryFullDay());
  await expect
    .poll(() => date.evaluate((el: HTMLInputElement) => el.validationMessage))
    .toBe("На эту дату заказы набраны — выберите другую дату.");
  await date.fill(nextDow(1));

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

test("админка: ручной заказ на нерабочий или занятый день — предупреждение, настройки хранят лимит", async ({
  page,
}) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.DELIVERY_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.DELIVERY_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/admin/orders/new");
  const at = page.locator('input[name="at"]');
  await at.fill(nextDow(0));
  await expect(page.getByText("В этот день выдачи нет по настройкам магазина.")).toBeVisible();
  await at.fill(F.deliveryFullDay());
  await expect(page.getByText("На эту дату заказы уже набраны по лимиту.")).toBeVisible();
  await at.fill(nextDow(1));
  await expect(page.getByText("заказы уже набраны по лимиту")).toHaveCount(0);

  await page.goto("/admin/settings");
  await expect(page.locator('input[name="day_limit"]')).toHaveValue(String(F.DELIVERY_DAY_LIMIT));
  await expect(page.locator('input[name="closed7"]')).toBeChecked();
  expect(errors).toEqual([]);
});
