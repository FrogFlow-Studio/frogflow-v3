import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * В21: витрина как приложение — service worker магазина, страница «нет сети» и
 * подсказка «Добавить на главный экран» со второго визита.
 */
test("service worker магазина: свой адрес, кеширует только страницу «нет сети»", async ({
  request,
}) => {
  const res = await request.get(`/s/${F.SHOP_SLUG}/sw.js`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("javascript");
  expect(res.headers()["cache-control"]).toContain("no-cache");
  const body = await res.text();
  expect(body).toContain(`/s/${F.SHOP_SLUG}/offline`);
  expect(body).not.toContain("addAll");
  expect((await request.get(`/s/no-such-shop-19/sw.js`)).status()).toBe(404);
});

test("страница «нет сети»: название магазина и «Повторить», без каталога", async ({ request }) => {
  const res = await request.get(`/s/${F.SHOP_SLUG}/offline`);
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain("Нет подключения к сети");
  expect(html).toContain("Повторить");
  expect(html).toContain('<meta name="robots" content="noindex">');
  expect((await request.get(`/s/no-such-shop-19/offline`)).status()).toBe(404);
});

test("service worker ставится, берёт витрину под контроль и сохраняет страницу «нет сети»", async ({
  page,
}) => {
  const errors = await watch(page);
  await page.goto(`/s/${F.SHOP_SLUG}`);
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await navigator.serviceWorker.getRegistrations()).some((r) => Boolean(r.active)),
      ),
    )
    .toBe(true);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  // Сохранена только страница «нет сети»; каталога и цен в кеше нет.
  const cached = await page.evaluate(async () => {
    const out: string[] = [];
    for (const k of await caches.keys()) {
      for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname);
    }
    return out;
  });
  expect(cached).toEqual([`/s/${F.SHOP_SLUG}/offline`]);
  // Поведение без сети — в юнит-тесте pwa.test.ts: setOffline в Playwright не касается запросов самого service worker.
  expect(errors).toEqual([]);
});

test("подсказка установки: на втором визите, «Не сейчас» прячет её", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "только телефон");
  // Android Chrome присылает beforeinstallprompt сам; в тесте событие приходит от страницы.
  await page.addInitScript(() => {
    window.addEventListener("load", () =>
      setTimeout(() => {
        const e = new Event("beforeinstallprompt", { cancelable: true });
        (e as unknown as { prompt: () => Promise<void> }).prompt = async () => {};
        window.dispatchEvent(e);
      }, 300),
    );
  });
  await page.goto(`/s/${F.SHOP_SLUG}`);
  await expect(page.getByText("Добавить магазин на главный экран", { exact: true })).toHaveCount(0);
  // Второй визит — новое открытие сайта.
  await page.evaluate((slug) => sessionStorage.removeItem(`ff-install-${slug}`), F.SHOP_SLUG);
  await page.reload();
  await expect(page.getByText("Добавить магазин на главный экран", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Не сейчас", exact: true }).click();
  await expect(page.getByText("Добавить магазин на главный экран", { exact: true })).toHaveCount(0);
  await page.evaluate((slug) => sessionStorage.removeItem(`ff-install-${slug}`), F.SHOP_SLUG);
  await page.reload();
  await page.waitForTimeout(800);
  await expect(page.getByText("Добавить магазин на главный экран", { exact: true })).toHaveCount(0);
});
