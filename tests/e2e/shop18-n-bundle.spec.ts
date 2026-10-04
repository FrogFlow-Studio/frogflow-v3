import { expect, test, type APIRequestContext } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Набор на витрине: карточка с бейджем «Набор» и выгодой, страница с составом,
 * фильтр «Наборы», набор в корзину, заказ на цену набора и списание составляющих
 * (core/bundles/stock): шампуня уходит вдвое больше, чем бальзама. Прогоны desktop и
 * phone идут одновременно на одной базе, поэтому сверяем отношение убыли, а не числа.
 */
type Order = { id: number; status: string; total: number; platform: string };
type Stock = { id: string; stock_quantity: number | null };
const stockOf = async (request: APIRequestContext, id: string) =>
  ((await (await request.get(`${F.STUB}/__e2e/tables/products`)).json()) as Stock[]).find(
    (p) => p.id === id,
  )!.stock_quantity!;
const ordersOf = async (request: APIRequestContext) =>
  (await (await request.get(`${F.STUB}/__e2e/tables/orders`)).json()) as Order[];

test("витрина: набор — состав, выгода, фильтр «Наборы», корзина и заказ", async ({
  page,
  request,
}, info) => {
  const errors = await watch(page);
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `10.18.${info.project.name === "phone" ? 2 : 1}.${Date.now() % 250}`,
  });
  const shampoo0 = await stockOf(request, F.BUNDLE_SHAMPOO_ID);
  const balm0 = await stockOf(request, F.BUNDLE_BALM_ID);
  await page.goto(`/s/${F.BUNDLE_SHOP_SLUG}`);
  const card = page.locator("article").filter({ hasText: F.BUNDLE_NAME });
  await expect(card.getByText("Набор", { exact: true })).toBeVisible();
  await expect(card).toContainText(/Выгода\s+2[\s\u00a0]?500/);

  await page.getByLabel("Наборы", { exact: true }).check();
  await page.getByRole("button", { name: "Применить", exact: true }).click();
  await expect(page).toHaveURL(/sets=1/);
  await expect(page.getByText(F.BUNDLE_NAME).first()).toBeVisible();
  await expect(page.getByText(F.BUNDLE_TOWEL_NAME)).toHaveCount(0);
  await expect(page.getByText(F.BUNDLE_SHAMPOO_NAME)).toHaveCount(0);

  await page.getByRole("link", { name: "Сбросить фильтры", exact: true }).click();
  await expect(page).not.toHaveURL(/sets=/);
  await expect(page.getByText(F.BUNDLE_SHAMPOO_NAME).first()).toBeVisible();

  await page.goto(`/s/${F.BUNDLE_SHOP_SLUG}/p/${F.BUNDLE_ID}`);
  const parts = page.getByTestId("bundle-parts");
  await expect(parts).toContainText(`${F.BUNDLE_SHAMPOO_NAME} × 2`);
  await expect(parts).toContainText(`${F.BUNDLE_BALM_NAME} × 1`);
  await expect(parts).toContainText(/Выгода\s+2[\s\u00a0]?500/);
  await page.getByRole("button", { name: "🛒 В корзину", exact: true }).click();

  await page.goto(`/s/${F.BUNDLE_SHOP_SLUG}/cart`);
  await expect(page.getByText(F.BUNDLE_NAME).first()).toBeVisible();
  await page.getByRole("link", { name: "Оформить на сайте", exact: true }).click();
  // Набор — физический товар: нужна дата получения.
  await page
    .locator('input[name="date"]')
    .fill(new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10));
  await page.locator('input[name="name"]').fill("Набор E2E");
  await page
    .locator('input[name="email"]')
    .fill(`bundle-${info.project.name}-${Date.now()}@example.test`);
  await page.locator('input[name="phone"]').fill("+77001234567");
  await page.getByRole("button", { name: "Перейти к оплате", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/s/${F.BUNDLE_SHOP_SLUG}/order/\\d+\\?t=[0-9a-f]{32}$`),
    {
      timeout: 30_000,
    },
  );
  const id = Number(new URL(page.url()).pathname.split("/").pop());
  const order = (await ordersOf(request)).find((o) => o.id === id)!;
  expect(order).toMatchObject({
    status: "awaiting_payment",
    total: F.BUNDLE_PRICE,
    platform: "web",
  });
  // Набор списал составляющие: 2 шампуня и 1 бальзам на набор.
  const shampooUsed = shampoo0 - (await stockOf(request, F.BUNDLE_SHAMPOO_ID));
  const balmUsed = balm0 - (await stockOf(request, F.BUNDLE_BALM_ID));
  expect(balmUsed).toBeGreaterThanOrEqual(1);
  expect(shampooUsed).toBe(2 * balmUsed);
  expect(errors).toEqual([]);
});
