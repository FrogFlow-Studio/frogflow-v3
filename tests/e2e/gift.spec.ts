import { createHash } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import * as F from "./fixtures.ts";

/**
 * Подарочный сертификат на витрине сайта: номинал → оплата картой через
 * Robokassa продавца → код на странице заказа. До оплаты кода нет; повторный
 * колбэк оплаты второго кода не создаёт.
 */

const md5 = (s: string) => createHash("md5").update(s).digest("hex");

async function table<T>(request: APIRequestContext, name: string): Promise<T[]> {
  return (await (await request.get(`${F.STUB}/__e2e/tables/${name}`)).json()) as T[];
}

test("покупатель покупает подарочный сертификат и после оплаты видит код", async ({
  page,
  request,
}, info) => {
  const errors: string[] = [];
  const robokassa: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Свой адрес: лимит оформлений с одного IP общий на весь прогон.
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${40 + info.workerIndex}` });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    if (r.request().url().startsWith("https://auth.robokassa.kz/"))
      robokassa.push(r.request().url());
    return r.abort();
  });

  await page.goto(`/s/${F.SHOP_SLUG}`);
  await page.getByRole("link", { name: "Подарочный сертификат" }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${F.SHOP_SLUG}/gift$`));
  await page.locator("label", { hasText: /^10\s?000/ }).click();
  await expect(page.getByRole("radio", { name: /^10\s?000/ })).toBeChecked();
  await page.locator('input[name="name"]').fill("Анна E2E");
  const email = `gift-${info.project.name}-${Date.now()}@example.com`;
  await page.locator('input[name="email"]').fill(email);
  await page.getByRole("button", { name: "Перейти к оплате" }).click();

  await expect(page).toHaveURL(new RegExp(`/s/${F.SHOP_SLUG}/order/\\d+\\?t=[0-9a-f]{32}$`), {
    timeout: 30_000,
  });
  const orderUrl = page.url();
  const id = Number(new URL(orderUrl).pathname.split("/").pop());
  await expect(page.getByText(/Подарочный сертификат 10/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ваш подарочный сертификат" })).toHaveCount(0);
  const certsBefore = await table<{ code: string }>(request, "gift_certificates");

  await page.getByRole("button", { name: "Оплатить картой" }).click();
  await expect.poll(() => robokassa.length).toBeGreaterThan(0);
  const pay = new URL(robokassa[0]!);
  expect(pay.searchParams.get("InvId")).toBe(String(id));
  const outSum = pay.searchParams.get("OutSum")!;
  expect(Number(outSum)).toBe(10000);

  const callback = () =>
    request.post(`/api/robokassa/${F.SHOP_ID}/result`, {
      form: {
        OutSum: outSum,
        InvId: String(id),
        SignatureValue: md5(`${outSum}:${id}:${F.ROBOKASSA.pass2}:Shp_bot=${F.SHOP_ID}`),
        Shp_bot: F.SHOP_ID,
      },
    });
  expect(await (await callback()).text()).toBe(`OK${id}`);
  await expect
    .poll(
      async () =>
        (await table<{ id: number; status: string }>(request, "orders")).find((o) => o.id === id)
          ?.status,
      { timeout: 15_000 },
    )
    .toBe("delivered");
  // Повтор колбэка — тот же код, второго сертификата нет.
  await callback();
  const mark = (await table<{ key: string; value: string }>(request, "app_settings")).find(
    (r) => r.key === `gift_sale:${id}`,
  );
  const code = (JSON.parse(mark!.value) as { code: string }).code;
  const mine = (await table<{ code: string; amount: number }>(request, "gift_certificates")).filter(
    (c) => c.code === code,
  );
  expect(mine).toHaveLength(1);
  expect(mine[0]!.amount).toBe(10000);
  expect(certsBefore.some((c) => c.code === code)).toBe(false);

  // Оплата увела вкладку на Robokassa — покупатель возвращается по своей ссылке.
  await page.goto(orderUrl);
  await expect(page.getByRole("heading", { name: "Ваш подарочный сертификат" })).toBeVisible();
  await expect(page.getByText(code)).toBeVisible();
  expect(errors).toEqual([]);
});
