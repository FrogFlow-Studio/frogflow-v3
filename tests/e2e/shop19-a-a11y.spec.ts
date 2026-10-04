import { expect, test, type Page } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * А10: тёмная тема и читаемость. Без внешних библиотек: контраст каждого видимого
 * текста против фактического фона (≥ 4,5:1, крупный ≥ 3:1) и размер шрифта на телефоне ≥ 14 px.
 */
async function lowContrast(page: Page) {
  return page.evaluate(() => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const cx = cv.getContext("2d", { willReadFrequently: true })!;
    const rgba = (c: string): [number, number, number, number] => {
      cx.clearRect(0, 0, 1, 1);
      cx.fillStyle = "#000";
      cx.fillStyle = c;
      cx.fillRect(0, 0, 1, 1);
      const d = cx.getImageData(0, 0, 1, 1).data;
      return [d[0]!, d[1]!, d[2]!, d[3]! / 255];
    };
    const over = (f: number[], b: number[]) => {
      const a = f[3]!;
      return [0, 1, 2].map((i) => f[i]! * a + b[i]! * (1 - a));
    };
    const bgOf = (el: Element): number[] => {
      const chain: number[][] = [];
      for (let e: Element | null = el; e; e = e.parentElement) {
        const c = rgba(getComputedStyle(e).backgroundColor);
        if (c[3] > 0) chain.push(c);
        if (c[3] === 1) break;
      }
      let acc = rgba(getComputedStyle(document.documentElement).backgroundColor);
      if (acc[3] === 0) acc = [255, 255, 255, 1];
      for (const c of chain.reverse()) acc = [...over(c, acc), 1] as typeof acc;
      return acc;
    };
    const lum = (c: number[]) => {
      const f = c.slice(0, 3).map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * f[0]! + 0.7152 * f[1]! + 0.0722 * f[2]!;
    };
    const bad: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || seen.has(el) || !n.textContent?.trim()) continue;
      seen.add(el);
      if (["SCRIPT", "STYLE", "OPTION"].includes(el.tagName)) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || cs.display === "none")
        continue;
      if ((el as HTMLButtonElement).disabled || el.closest("[disabled]")) continue;
      const fg = rgba(cs.color);
      const bg = bgOf(el);
      const text = over(fg, bg);
      const l1 = lum(text);
      const l2 = lum(bg);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const px = parseFloat(cs.fontSize);
      const large = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5))
        bad.push(
          `${el.tagName.toLowerCase()} «${n.textContent.trim().slice(0, 30)}» ${ratio.toFixed(2)}`,
        );
    }
    return bad;
  });
}

const PAGES = ["/admin/warehouse", "/admin/broadcasts", "/admin/products/new"];

test("тёмная тема: текст читаем на новых разделах (Склад, Розыгрыши, карточка товара)", async ({
  page,
}) => {
  const errors = await watch(page);
  await page.addInitScript(() => localStorage.setItem("ff-theme", "dark"));
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.A11Y19_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.A11Y19_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  for (const path of PAGES) {
    await page.goto(path);
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.locator("main h1").first()).toBeVisible();
    // Тема включается после загрузки, цвета плавно переходят: ждём конца перехода.
    await page.waitForTimeout(600);
    expect(await lowContrast(page), path).toEqual([]);
  }
  expect(errors).toEqual([]);
});

test("телефон: основной текст не мельче 14 px", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "только телефон");
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.A11Y19_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.A11Y19_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  for (const path of PAGES) {
    await page.goto(path);
    await expect(page.locator("main h1").first()).toBeVisible();
    const small = await page.evaluate(() =>
      [...document.querySelectorAll("main *")]
        .filter((el) => {
          const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim());
          const r = el.getBoundingClientRect();
          return own && r.width > 0 && parseFloat(getComputedStyle(el).fontSize) < 14;
        })
        .map((el) => `${el.tagName.toLowerCase()} «${el.textContent?.trim().slice(0, 30)}»`),
    );
    expect(small, path).toEqual([]);
  }
});
