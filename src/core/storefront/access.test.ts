import { describe, expect, it } from "vitest";
import { storefrontAllows, storefrontOpen } from "./access";

describe("доступ к витрине по модулям", () => {
  it("без магазина закрыто всё", () => {
    const m = { web_storefront: true, telegram_mini_app: true, legal_docs: true };
    for (const p of ["info", "catalog", "web_handoff", "mini_app", "legal", "order"] as const)
      expect(storefrontAllows(m, p)).toBe(false);
  });

  it("только базовый пакет: юр. страницы есть, витрины и Mini App нет", () => {
    const m = { shop: true, legal_docs: true };
    expect(storefrontAllows(m, "catalog")).toBe(false);
    expect(storefrontAllows(m, "web_handoff")).toBe(false);
    expect(storefrontAllows(m, "mini_app")).toBe(false);
    expect(storefrontAllows(m, "legal")).toBe(true);
    expect(storefrontAllows(m, "info")).toBe(true);
  });

  it("страница заказа и её шапка открыты при любом магазине (ссылка из Direct/WhatsApp)", () => {
    expect(storefrontAllows({ shop: true }, "order")).toBe(true);
    expect(storefrontAllows({ shop: true }, "info")).toBe(true);
    expect(storefrontAllows({ shop: true }, "catalog")).toBe(false);
    expect(storefrontAllows({ shop: true }, "legal")).toBe(false);
    expect(storefrontAllows({ legal_docs: true }, "order")).toBe(false);
  });

  it("веб-витрина: каталог и корзина с сайта, но не Mini App", () => {
    const m = { shop: true, web_storefront: true };
    expect(storefrontAllows(m, "catalog")).toBe(true);
    expect(storefrontAllows(m, "web_handoff")).toBe(true);
    expect(storefrontAllows(m, "mini_app")).toBe(false);
  });

  it("Mini App: каталог и оформление в Telegram, но не корзина с сайта", () => {
    const m = { shop: true, telegram_mini_app: true };
    expect(storefrontAllows(m, "catalog")).toBe(true);
    expect(storefrontAllows(m, "mini_app")).toBe(true);
    expect(storefrontAllows(m, "web_handoff")).toBe(false);
    expect(storefrontAllows(m, "legal")).toBe(false);
  });
});

describe("витрина клиента открыта или «не найдена»", () => {
  const shop = {
    archived: false,
    settings: { served_by: "v2" as const },
    modules: { shop: true, web_storefront: true, legal_docs: true },
  };

  it("нет клиента, архив, клиент v1 — не найдена", () => {
    expect(storefrontOpen(null, "info")).toBe(false);
    expect(storefrontOpen({ ...shop, archived: true }, "catalog")).toBe(false);
    expect(storefrontOpen({ ...shop, settings: { served_by: "v1" } }, "catalog")).toBe(false);
    expect(storefrontOpen({ ...shop, settings: {} }, "catalog")).toBe(false);
  });

  it("шапка открыта по юр. страницам, каталог — только с оплаченной витриной", () => {
    const basic = { ...shop, modules: { shop: true, legal_docs: true } };
    expect(storefrontOpen(basic, "info")).toBe(true);
    expect(storefrontOpen(basic, "catalog")).toBe(false);
    expect(storefrontOpen(shop, "catalog")).toBe(true);
  });
});
