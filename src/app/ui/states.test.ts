import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-router")>()),
  Link: ({ to, children, className }: { to: string; children: unknown; className?: string }) =>
    h("a", { href: to, className }, children as never),
  useRouter: () => ({ invalidate: () => Promise.resolve() }),
}));

import { EmptyState, LoadError } from "./states";

describe("EmptyState", () => {
  it("называет раздел, объясняет и даёт кнопку-ссылку", () => {
    const html = renderToStaticMarkup(
      h(EmptyState, {
        title: "Заказов пока нет",
        hint: "Появятся после первой покупки.",
        action: { label: "Предпросмотр бота", to: "/admin/bot-preview" as never },
      }),
    );
    expect(html).toContain("Заказов пока нет");
    expect(html).toContain("Появятся после первой покупки.");
    expect(html).toContain('href="/admin/bot-preview"');
    expect(html).toContain("Предпросмотр бота");
  });
  it("без действия и подсказки — только заголовок, без кнопки", () => {
    const html = renderToStaticMarkup(h(EmptyState, { title: "Пусто" }));
    expect(html).toContain("Пусто");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<a ");
  });
  it("действие без ссылки рисуется как button", () => {
    const html = renderToStaticMarkup(
      h(EmptyState, { title: "Пусто", action: { label: "Добавить", onClick: () => {} } }),
    );
    expect(html).toContain("<button");
    expect(html).toContain("Добавить");
  });
});

describe("LoadError", () => {
  it("сбой — понятная фраза и «Повторить», сырого текста нет", () => {
    const html = renderToStaticMarkup(
      h(LoadError, { error: new Error("TypeError: x is undefined") }),
    );
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("TypeError");
    expect(html).toContain("<button");
  });
  it("своя фраза выводится как есть", () => {
    const html = renderToStaticMarkup(h(LoadError, { message: "Не удалось загрузить заказы" }));
    expect(html).toContain("Не удалось загрузить заказы");
  });
});
