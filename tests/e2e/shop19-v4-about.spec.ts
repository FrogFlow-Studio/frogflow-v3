import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** В4: страница «О магазине» из bots.settings.storefront_about, разметка и ссылка в подвале. */
test("о магазине: контакты, доставка, оплата, ссылка в подвале и разметка LocalBusiness", async ({
  page,
  request,
}) => {
  const errors = await watch(page);
  await page.goto(`/s/${F.DESIGN_SHOP_SLUG}`);
  await page.getByRole("link", { name: "О магазине", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${F.DESIGN_SHOP_SLUG}/about$`));
  await expect(page.getByRole("heading", { name: "О магазине", exact: true })).toBeVisible();
  await expect(page.getByText("Соевые свечи ручной работы.")).toBeVisible();
  const contacts = page.getByTestId("about-contacts");
  await expect(contacts.getByText("+7 700 111 22 33")).toBeVisible();
  await expect(contacts.getByText("Алматы, ул. Абая, 1")).toBeVisible();
  await expect(page.getByText("Курьером по Алматы за 1 день.")).toBeVisible();
  await expect(page.getByText("Kaspi или наличными.")).toBeVisible();

  const html = await (await request.get(`/s/${F.DESIGN_SHOP_SLUG}/about`)).text();
  const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map(
    (m) => JSON.parse(m[1]!) as Record<string, unknown>,
  );
  const biz = ld.find((b) => b["@type"] === "LocalBusiness") as Record<string, unknown>;
  expect(biz.telephone).toBe("+7 700 111 22 33");
  expect(html).toContain(`/s/${F.DESIGN_SHOP_SLUG}/about"`);
  expect(errors).toEqual([]);
});

test("о магазине: пока ничего не заполнено — страницы нет и ссылки нет", async ({
  page,
  request,
}) => {
  const errors = await watch(page);
  await page.goto(`/s/${F.SHOP_SLUG}`);
  await expect(page.getByRole("link", { name: "О магазине", exact: true })).toHaveCount(0);
  const res = await request.get(`/s/${F.SHOP_SLUG}/about`);
  expect(res.status()).toBe(404);
  expect(errors).toEqual([]);
});
