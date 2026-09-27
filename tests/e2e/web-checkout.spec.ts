import { createHash } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import * as F from "./fixtures.ts";

/**
 * Покупка на витрине сайта без мессенджера: каталог → корзина → «Оформить на
 * сайте» (задача против ботов решается в браузере) → страница заказа →
 * оплата картой через Robokassa продавца → материалы на странице заказа.
 * Второй путь — перевод по реквизитам Kaspi и чек, который продавец
 * подтверждает в админке (автопроверки чеков в прогоне нет: ключа Vision нет).
 * База подставная (pg-stub.ts), Robokassa — наши же подписанные колбэки.
 */

type Order = {
  id: number;
  status: string;
  total: number;
  platform: string;
  display_name: string | null;
  customer_email: string | null;
};

async function orderOf(request: APIRequestContext, id: number): Promise<Order> {
  const all = (await (await request.get(`${F.STUB}/__e2e/tables/orders`)).json()) as Order[];
  return all.find((o) => o.id === id)!;
}

async function watch(page: Page): Promise<{ errors: string[]; robokassa: string[] }> {
  const errors: string[] = [];
  const robokassa: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    if (r.request().url().startsWith("https://auth.robokassa.kz/"))
      robokassa.push(r.request().url());
    return r.abort();
  });
  return { errors, robokassa };
}

const md5 = (s: string) => createHash("md5").update(s).digest("hex");

/** Каталог → корзина → оформление → страница заказа; возвращает номер заказа. */
async function placeWebOrder(page: Page, request: APIRequestContext, email: string) {
  await page.goto(`/s/${F.SHOP_SLUG}`);
  await page.getByRole("button", { name: "В корзину" }).first().click();
  await page.goto(`/s/${F.SHOP_SLUG}/cart`);
  await page.getByRole("link", { name: "Оформить на сайте" }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${F.SHOP_SLUG}/checkout$`));

  await page.locator('input[name="name"]').fill("Анна E2E");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="phone"]').fill("+77001234567");
  await page.getByRole("button", { name: "Перейти к оплате" }).click();

  await expect(page).toHaveURL(new RegExp(`/s/${F.SHOP_SLUG}/order/\\d+\\?t=[0-9a-f]{32}$`), {
    timeout: 30_000,
  });
  const orderUrl = new URL(page.url());
  const id = Number(orderUrl.pathname.split("/").pop());
  await expect(page.getByRole("heading", { name: /Заказ №/ })).toBeVisible();
  await expect(page.getByText("Kaspi Gold 4400")).toBeVisible();
  expect(await orderOf(request, id)).toMatchObject({
    status: "awaiting_payment",
    total: F.PRODUCT_PRICE,
    platform: "web",
    display_name: "Анна E2E",
    customer_email: email,
  });

  // Без подписанной ссылки в чужом браузере заказ не открыть.
  const stranger = await page.context().browser()!.newPage();
  await stranger.goto(`/s/${F.SHOP_SLUG}/order/${id}?t=${"0".repeat(32)}`);
  await expect(stranger.getByRole("heading", { name: /Заказ №/ })).toHaveCount(0);
  await stranger.close();
  return id;
}

test("покупатель оформляет и оплачивает картой на сайте — материалы на странице заказа", async ({
  page,
  request,
}, info) => {
  const { errors, robokassa } = await watch(page);
  const email = `buyer-${info.project.name}-${Date.now()}@example.com`;

  const id = await placeWebOrder(page, request, email);

  // «Оплатить картой» уводит на Robokassa продавца (запрос перехвачен).
  await page.getByRole("button", { name: "Оплатить картой" }).click();
  await expect.poll(() => robokassa.length).toBeGreaterThan(0);
  const pay = new URL(robokassa[0]!);
  expect(pay.searchParams.get("InvId")).toBe(String(id));
  expect(pay.searchParams.get("MerchantLogin")).toBe(F.ROBOKASSA.login);
  const outSum = pay.searchParams.get("OutSum")!;

  // Robokassa подтверждает оплату (пароль №2) — заказ выдан сам.
  const ok = await request.post(`/api/robokassa/${F.SHOP_ID}/result`, {
    form: {
      OutSum: outSum,
      InvId: String(id),
      SignatureValue: md5(`${outSum}:${id}:${F.ROBOKASSA.pass2}:Shp_bot=${F.SHOP_ID}`),
      Shp_bot: F.SHOP_ID,
    },
  });
  expect(await ok.text()).toBe(`OK${id}`);
  await expect
    .poll(async () => (await orderOf(request, id)).status, { timeout: 15_000 })
    .toBe("delivered");

  // Возврат после отказа: ссылки в адресе нет, страница берёт её из браузера.
  await page.goto(
    `/api/robokassa/${F.SHOP_ID}/fail?OutSum=${outSum}&InvId=${id}&Shp_bot=${F.SHOP_ID}`,
  );
  await expect(page).toHaveURL(new RegExp(`/s/${F.SHOP_SLUG}/order/${id}(\\?t=)?$`));
  await expect(page.getByRole("heading", { name: "Ваши материалы" })).toBeVisible();

  // Возврат после успеха (подпись паролем №1) — со ссылкой; файл товара на странице.
  const successSig = md5(`${outSum}:${id}:${F.ROBOKASSA.pass1}:Shp_bot=${F.SHOP_ID}`);
  await page.goto(
    `/api/robokassa/${F.SHOP_ID}/success?OutSum=${outSum}&InvId=${id}&SignatureValue=${successSig}&Shp_bot=${F.SHOP_ID}`,
  );
  await expect(page).toHaveURL(new RegExp(`/s/${F.SHOP_SLUG}/order/${id}\\?t=[0-9a-f]{32}$`));
  await expect(page.getByRole("heading", { name: "Ваши материалы" })).toBeVisible();
  await expect(page.getByRole("link", { name: "propisi.pdf" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("«С этим берут» в корзине сайта: правило продавца, товар добавляется одной кнопкой", async ({
  page,
}) => {
  const { errors } = await watch(page);
  await page.goto(`/s/${F.SHOP_SLUG}`);
  await page
    .locator("article", { hasText: F.PRODUCT_NAME })
    .getByRole("button", { name: "В корзину" })
    .click();
  await page.goto(`/s/${F.SHOP_SLUG}/cart`);
  const block = page.locator("section", { hasText: "С этим берут" });
  await expect(block.getByText(F.UPSELL_NAME)).toBeVisible();
  await block.getByRole("button", { name: "В корзину" }).click();
  // Товар ушёл в корзину — и из предложений: в корзине его уже не предлагаем.
  await expect(page.getByRole("list").first().getByText(F.UPSELL_NAME)).toBeVisible();
  await expect(page.locator("section", { hasText: "С этим берут" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

/** Чек-PDF со своим содержимым: один и тот же чек к двум заказам не принимается. */
const receiptPdf = (tag: string) =>
  Buffer.from(`%PDF-1.4
% Kaspi чек ${tag}
1 0 obj << >> endobj
trailer << >>
%%EOF
`);

test("покупатель платит переводом Kaspi и присылает чек, продавец подтверждает — материалы на странице заказа", async ({
  page,
  browser,
  request,
}, info) => {
  const { errors } = await watch(page);
  const email = `kaspi-${info.project.name}-${Date.now()}@example.com`;
  const id = await placeWebOrder(page, request, email);
  const orderUrl = page.url();

  // Чек — файлом со страницы заказа: заказ ждёт продавца, страница это говорит.
  await page.locator('input[type="file"]').setInputFiles({
    name: "kaspi-check.pdf",
    mimeType: "application/pdf",
    buffer: receiptPdf(email),
  });
  await expect(page.getByText("Чек получен — продавец проверит его и выдаст заказ.")).toBeVisible();
  await expect.poll(async () => (await orderOf(request, id)).status).toBe("awaiting_confirmation");
  // Вернулся позже по своей ссылке — страница помнит, что чек на проверке.
  await page.goto(orderUrl);
  await expect(
    page.getByText("Чек у продавца на проверке — материалы появятся здесь."),
  ).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);

  // Продавец подтверждает в веб-админке (своя вкладка).
  const seller = await browser.newPage();
  await watch(seller);
  await seller.goto("/admin/login");
  await seller.locator('input[name="username"]').fill(F.SELLER_LOGIN);
  await seller.locator('input[name="password"]').fill(F.SELLER_PASSWORD);
  await seller.getByRole("button", { name: "Войти" }).click();
  await expect(seller).toHaveURL(/\/admin$/);
  await seller.goto(`/admin/orders/${id}`);
  await seller.getByRole("button", { name: "✅ Подтвердить и выдать" }).click();
  await expect(seller.getByText(/выдан: 1 поз\./)).toBeVisible();
  await seller.close();
  await expect
    .poll(async () => (await orderOf(request, id)).status, { timeout: 15_000 })
    .toBe("delivered");

  // Покупатель по своей ссылке видит материалы.
  await page.goto(orderUrl);
  await expect(page.getByRole("heading", { name: "Ваши материалы" })).toBeVisible();
  await expect(page.getByRole("link", { name: "propisi.pdf" })).toBeVisible();
  expect(errors).toEqual([]);
});
