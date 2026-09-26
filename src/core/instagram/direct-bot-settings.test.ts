import { describe, expect, it } from "vitest";
import {
  directBotSettingKeys,
  directBotSettingsFrom,
  isTriggerWord,
  parseFeatures,
  parseTriggerWords,
} from "./direct-bot-settings";

describe("настройки автоответчика Direct/WhatsApp", () => {
  it("ключи те же, что в v1, свои у каждого канала", () => {
    expect(directBotSettingKeys("instagram")).toContain("instagram_direct_bot_scope");
    expect(directBotSettingKeys("whatsapp")).toContain("whatsapp_bot_triggers");
  });
  it("пусто — включён, только по заказам, всё из магазина доступно", () => {
    const s = directBotSettingsFrom({}, "instagram");
    expect(s).toEqual({
      enabled: true,
      scope: "purchases",
      triggers: [],
      script: "",
      features: { catalog: true, search: true, cart: true, checkout: true },
      ignoreExcluded: false,
      notifyTemplate: "",
    });
  });
  it("читает значения v1: выключен, на все сообщения, слова-вызовы, функции", () => {
    const s = directBotSettingsFrom(
      {
        whatsapp_bot_enabled: "false",
        whatsapp_bot_scope: "all",
        whatsapp_bot_triggers: "Заказать, купить!\nПрайс;",
        whatsapp_bot_features: '{"checkout":false,"cart":"нет"}',
        whatsapp_bot_script: "  Напишите «каталог».  ",
        whatsapp_bot_ignore_excluded_contacts: "true",
        whatsapp_bot_notify_template: "order_update:ru",
      },
      "whatsapp",
    );
    expect(s.enabled).toBe(false);
    expect(s.scope).toBe("all");
    expect(s.triggers).toEqual(["заказать", "купить", "прайс"]);
    expect(s.features).toEqual({ catalog: true, search: true, cart: true, checkout: false });
    expect(s.script).toBe("Напишите «каталог».");
    expect(s.ignoreExcluded).toBe(true);
    expect(s.notifyTemplate).toBe("order_update:ru");
  });
  it("слово-вызов совпадает целиком без учёта регистра и знаков", () => {
    const triggers = parseTriggerWords("прайс, хочу заказать");
    expect(isTriggerWord("ПРАЙС!", triggers)).toBe(true);
    expect(isTriggerWord("Хочу  заказать", triggers)).toBe(true);
    expect(isTriggerWord("прайс на завтра", triggers)).toBe(false);
    expect(isTriggerWord("прайс", [])).toBe(false);
  });
  it("битый JSON функций не ломает разбор", () => {
    expect(parseFeatures("{oops").catalog).toBe(true);
  });
});
