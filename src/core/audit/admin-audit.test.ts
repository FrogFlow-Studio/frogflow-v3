import { describe, expect, it } from "vitest";
import {
  ADMIN_AUDIT_ACTOR_PREFIX,
  auditDetails,
  auditedAdminAction,
  shopActor,
} from "./admin-audit";

const fn = (name: string, filename = "src/app/admin/admin.functions.ts") => ({ name, filename });

describe("журнал действий админки: что пишем", () => {
  it("изменения в админке — да, заказы, чат, чтение и вход — нет", () => {
    expect(auditedAdminAction(fn("saveProductFn"), "POST")).toBe("saveProductFn");
    expect(auditedAdminAction(fn("saveCrmFn", "src/app/admin/crm.functions.ts"), "POST")).toBe(
      "saveCrmFn",
    );
    // Неизвестная новая функция админки тоже попадёт в журнал — по имени.
    expect(auditedAdminAction(fn("brandNewThingFn"), "POST")).toBe("brandNewThingFn");
    for (const name of [
      "orderActionFn",
      "orderNoteFn",
      "createManualOrderFn",
      "recordPaymentFn",
      "updateFulfillmentFn",
      "outboxActionFn",
      "chatReplyFn",
      "chatConnectFn",
      "adminLogin",
      "adminLogout",
      "previewQuizFn",
      "consultantTestFn",
      "testCrmFn",
      "vipProofUrlFn",
      "zernioConnectLinkFn",
      "hideSetupFn",
    ])
      expect(auditedAdminAction(fn(name), "POST"), name).toBeNull();
    expect(auditedAdminAction(fn("saveProductFn"), "GET")).toBeNull();
    expect(
      auditedAdminAction(fn("setModuleFn", "src/app/operator/operator.functions.ts"), "POST"),
    ).toBeNull();
    expect(auditedAdminAction(undefined, "POST")).toBeNull();
  });

  it("исполнитель — логин из сессии с префиксом", () => {
    expect(shopActor("masha")).toBe(`${ADMIN_AUDIT_ACTOR_PREFIX}masha`);
    expect(shopActor("masha")).toBe("admin:masha");
  });
});

describe("журнал действий админки: подробности без секретов", () => {
  it("пароли, токены, ключи и секреты не пишутся", () => {
    const d = auditDetails({
      username: "masha",
      role: "manager",
      password: "manager-pass-1",
      token: "123:ABC",
      secret: "s3",
      pass2: "robokassa",
      apiKey: "k",
      nested: { password: "x" },
    });
    expect(d).toEqual({
      username: "masha",
      role: "manager",
      password: "•••",
      token: "•••",
      secret: "•••",
      pass2: "•••",
      apiKey: "•••",
      nested: "{…}",
    });
    expect(JSON.stringify(d)).not.toMatch(/manager-pass-1|123:ABC|robokassa/);
  });

  it("длинный текст и списки сворачиваются, пустое пропускается, полей не больше 12", () => {
    const d = auditDetails({
      id: "a1",
      name: "Торт «Наполеон»",
      description: "х".repeat(500),
      images: ["a", "b", "c"],
      price: 5000,
      isActive: false,
      note: null,
      extra: undefined,
    });
    expect(d).toEqual({
      id: "a1",
      name: "Торт «Наполеон»",
      description: "(текст, 500 симв.)",
      images: "[3]",
      price: 5000,
      isActive: false,
    });
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`f${i}`, i]));
    expect(Object.keys(auditDetails(many))).toHaveLength(12);
    expect(auditDetails({ ["k".repeat(41)]: 1, ok: 2 })).toEqual({ ok: 2 });
  });

  it("не объект — пусто; строка данных — как значение", () => {
    expect(auditDetails(undefined)).toEqual({});
    expect(auditDetails(null)).toEqual({});
    expect(auditDetails("ru")).toEqual({ value: "ru" });
  });
});
