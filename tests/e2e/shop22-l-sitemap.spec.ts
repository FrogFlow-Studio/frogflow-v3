import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";

/** Карта площадки (Л4): в индексе платформы есть, в ней автор и его товар, клиента прежней платформы нет. */
const S = F.SH20_SHOP;
const P = F.SH20_PRODUCT;

test("sitemap-market.xml: автор и товар Лавки Ш20, индекс ссылается на карту", async ({
  request,
}) => {
  const index = await (await request.get("/sitemap.xml")).text();
  expect(index).toContain("/sitemap-market.xml</loc>");
  const res = await request.get("/sitemap-market.xml");
  expect(res.status()).toBe(200);
  const xml = await res.text();
  expect(xml).toContain(`/s/${S.slug}</loc>`);
  expect(xml).toContain(`/s/${S.slug}/p/${P.id}</loc>`);
});
