import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

const pages = [
  "",
  "clients",
  "clients/new",
  "support",
  "requests",
  "community",
  "market-reports",
  "leads",
  "partners",
  "revenue",
  "renewals",
  "news",
  "broadcast",
  "market-collections",
  "market-stats",
  "health",
  "crons",
  "observer",
  "log",
  "settings",
  "bulk",
  "migration",
];
// 22 экрана, на каждом ожидание сети и снимок всей страницы: отдельно ~55 с, а в полном
// прогоне на 4 потоках телефонный проект упирался в 120 с (ежедневный прогон 01.11).
test.setTimeout(240_000);

test("рабочие области оператора: все экраны, широкая компоновка и переходы", async ({
  page,
}, info) => {
  const errors = await watch(page);
  if (info.project.name === "desktop") await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/operator/login");
  await page.locator('input[name="username"]').fill(F.OPERATOR_LOGIN);
  await page.locator('input[name="password"]').fill(F.OPERATOR_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/operator$/);
  for (const route of pages) {
    await page.goto(`/operator${route ? "/" + route : ""}`);
    await expect(page.locator("main h1")).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Рабочие области", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
      route,
    ).toBe(true);
    await page.waitForLoadState("networkidle");
    await page.screenshot({
      path: `output/playwright/operator-pages/${info.project.name}-${route.replaceAll("/", "-") || "overview"}.png`,
      fullPage: true,
    });
  }
  await page.goto("/operator/clients");
  await page.getByRole("button", { name: /Оплата скоро/, exact: true }).click();
  await expect(page).toHaveURL(/view=payment/);
  await page.reload();
  await expect(page.getByRole("button", { name: /Оплата скоро/, exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.goto(`/operator/clients/${F.SHOP_ID}`);
  await expect(
    page.getByRole("navigation", { name: "Разделы клиента", exact: true }),
  ).toBeVisible();
  const health = page
    .locator("section.card")
    .filter({ has: page.getByRole("heading", { name: "Здоровье бота", exact: true }) });
  await expect(health).toBeVisible();
  expect((await health.boundingBox())!.height).toBeLessThan(400);
  await page.screenshot({
    path: `output/playwright/operator-client-${info.project.name}.png`,
    fullPage: true,
  });
  const tabs = page.getByRole("navigation", { name: "Разделы клиента", exact: true });
  if (info.project.name === "phone") {
    await expect(tabs).toHaveCSS("display", "grid");
  }
  for (const tab of ["Каналы", "Оплата", "Настройки", "Журнал", "Переезд"]) {
    await tabs.getByRole("link", { name: tab, exact: true }).click();
    await expect(tabs.getByRole("link", { name: tab, exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
  }
  await page.goto("/operator/clients/new");
  await expect(page.getByRole("button", { name: "Создать клиента", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Тёмная/, exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.goto(`/operator/clients/${F.SHOP_ID}`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({
    path: `output/playwright/operator-client-${info.project.name}-dark.png`,
    fullPage: true,
  });
  await page.goto("/operator/settings");
  await page.waitForLoadState("networkidle");
  await page.screenshot({
    path: `output/playwright/operator-settings-${info.project.name}-dark.png`,
    fullPage: true,
  });
  if (info.project.name === "phone") {
    await page.setViewportSize({ width: 320, height: 740 });
    for (const route of ["clients", `clients/${F.SHOP_ID}`, "news", "revenue", "settings"]) {
      await page.goto("/operator/" + route);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
        route,
      ).toBe(true);
    }
  }
  expect(errors).toEqual([]);
});
