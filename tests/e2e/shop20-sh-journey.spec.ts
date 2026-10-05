import { expect, test, type APIRequestContext } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch, openFilters } from "./helpers.ts";

/**
 * Путь покупателя через площадку (Ш3): поиск товара → магазин → товар (с отзывом) → корзина →
 * заказ на сайте → страница статуса по ссылке. Оставить свой отзыв может только вошедший через
 * Telegram покупатель с выданным заказом, поэтому здесь — одобренный отзыв другого покупателя и
 * проверка, что страница заказа открывается только по подписанной ссылке. Вторая половина — клиент
 * прежней платформы: на площадке его товаров нет, витрина v2 его не отдаёт.
 */
const S = F.SH20_SHOP;
const P = F.SH20_PRODUCT;
const V = F.SH20_V1;

type Order = { id: number; status: string; total: number; platform: string; bot_id: string };
const orders = async (request: APIRequestContext) =>
  (await (await request.get(`${F.STUB}/__e2e/tables/orders`)).json()) as Order[];

test("площадка → поиск → магазин → товар → корзина → заказ → страница статуса", async ({
  page,
  request,
}, info) => {
  const errors = await watch(page);
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `10.20.${info.project.name === "phone" ? 2 : 1}.${Date.now() % 250}`,
  });

  await page.goto("/market/search");
  await openFilters(page);
  await page.getByRole("textbox", { name: "Что ищете", exact: true }).fill("пряник ш20");
  await page.getByRole("button", { name: "Найти", exact: true }).click();
  await expect(page.getByRole("heading", { name: P.name, exact: true })).toBeVisible();
  await expect(page.getByText(`в магазине ${S.name}`)).toBeVisible();
  await page.locator(`a[href="/s/${S.slug}"]`).first().click();

  await expect(page).toHaveURL(new RegExp(`/s/${S.slug}$`));
  await page.goto(`/s/${S.slug}/p/${P.id}`);
  await expect(page.getByRole("heading", { name: P.name, exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Отзывы покупателей", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(F.SH20_REVIEW.comment, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "🛒 В корзину", exact: true }).click();
  await page.goto(`/s/${S.slug}/cart`);
  await page.getByRole("link", { name: "Оформить на сайте", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${S.slug}/checkout$`));
  await page.locator('input[name="name"]').fill("Айгуль Ш20");
  await page
    .locator('input[name="email"]')
    .fill(`sh20-${info.project.name}-${Date.now()}@example.com`);
  await page.locator('input[name="phone"]').fill("+77001234568");
  await page.getByRole("button", { name: "Перейти к оплате", exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`/s/${S.slug}/order/\\d+\\?t=[0-9a-f]{32}$`), {
    timeout: 30_000,
  });
  const url = new URL(page.url());
  const id = Number(url.pathname.split("/").pop());
  await expect(page.getByRole("heading", { name: /Заказ №/ })).toBeVisible();
  await expect(page.getByText("Kaspi Gold 4400 1111 2222 3333")).toBeVisible();
  expect((await orders(request)).find((o) => o.id === id)).toMatchObject({
    bot_id: S.id,
    status: "awaiting_payment",
    total: 1500,
    platform: "web",
  });

  // Статус открывается по подписанной ссылке; без неё чужой браузер заказ не видит.
  await page.reload();
  await expect(page.getByRole("heading", { name: /Заказ №/ })).toBeVisible();
  const stranger = await page.context().browser()!.newPage();
  await stranger.goto(`/s/${S.slug}/order/${id}?t=${"0".repeat(32)}`);
  await expect(stranger.getByRole("heading", { name: /Заказ №/ })).toHaveCount(0);
  await stranger.close();
  expect(errors).toEqual([]);
});

test("клиент прежней платформы: товара нет в поиске площадки, витрина v2 его не отдаёт", async ({
  page,
  request,
}) => {
  await watch(page);
  const before = (await orders(request)).filter((o) => o.bot_id === V.id).length;
  await page.goto("/market/search?q=кекс ш20");
  await expect(page.getByText("Ничего не нашли. Попробуйте другое слово.")).toBeVisible();
  await expect(page.getByText(V.product.name)).toHaveCount(0);

  for (const path of ["", `/p/${V.product.id}`]) {
    const res = await page.goto(`/s/${V.slug}${path}`);
    expect(res?.status(), path).toBe(404);
    await expect(
      page.getByRole("heading", { name: "Магазин не найден", exact: true }),
    ).toBeVisible();
  }
  expect((await orders(request)).filter((o) => o.bot_id === V.id)).toHaveLength(before);
});
