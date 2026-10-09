import { describe, expect, it } from "vitest";
import {
  directBotSettingKeys,
  directBotSettingsFrom,
  isStartPostback,
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
      features: { catalog: true, search: true, cart: true, checkout: true, express: true },
      sellerPause: "30",
      ignoreExcluded: false,
      notifyTemplate: "",
    });
  });
  it("пауза после реплики продавца: 15/30/60/до конца дня, мусор — 30", () => {
    const pick = (v: string) =>
      directBotSettingsFrom({ instagram_direct_bot_seller_pause: v }, "instagram").sellerPause;
    expect(["15", "30", "60", "day"].map(pick)).toEqual(["15", "30", "60", "day"]);
    expect(pick("5")).toBe("30");
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
    expect(s.features).toEqual({
      catalog: true,
      search: true,
      cart: true,
      checkout: false,
      express: true,
    });
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
  it("treats a hidden /start payload as start even when the chat shows «купить»", () => {
    const triggers = parseTriggerWords("заказать, купить, магазин, каталог");
    expect(isStartPostback("/start", triggers)).toBe(true);
    expect(isStartPostback("/START", triggers)).toBe(true);
    expect(isStartPostback("start", [])).toBe(true);
  });
  it("treats a CMD payload that is itself a trigger word as start", () => {
    const triggers = parseTriggerWords("заказать, купить, магазин, каталог");
    expect(isStartPostback("Купить", triggers)).toBe(true);
    expect(isStartPostback("Купить", [])).toBe(false);
  });
  it("кнопки чужих автоматизаций и наши постбэки стартом не считаются", () => {
    const triggers = parseTriggerWords("купить");
    expect(isStartPostback("ACT::cc82e5ebd3b465e3243fde66982ba8d0", triggers)).toBe(false);
    expect(isStartPostback("CATALOG", triggers)).toBe(false);
    expect(isStartPostback(null, triggers)).toBe(false);
    expect(isStartPostback("", triggers)).toBe(false);
  });
  it("битый JSON функций не ломает разбор", () => {
    expect(parseFeatures("{oops").catalog).toBe(true);
  });
});
