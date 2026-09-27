import { describe, expect, it } from "vitest";
import {
  ICE_BREAKER_QUESTION_MAX,
  defaultIceBreakers,
  iceBreakerKind,
  iceBreakerQuestion,
  iceBreakersFor,
  parseIceBreakers,
} from "./ice-breakers";
import { DEFAULT_DIRECT_BOT } from "./direct-bot-settings";

const on = { instagram: true, dm_shop: true };
const enabled = () => ({ ...defaultIceBreakers(), enabled: true });

describe("быстрые вопросы Instagram: настройка", () => {
  it("по умолчанию выключены, четыре подсказки из задачи", () => {
    const d = parseIceBreakers(null);
    expect(d.enabled).toBe(false);
    expect(d.items.map((i) => i.question)).toEqual([
      "Каталог",
      "Мои заказы",
      "Как оплатить",
      "Связаться с продавцом",
    ]);
    expect(iceBreakersFor(d, DEFAULT_DIRECT_BOT, on)).toEqual([]);
  });

  it("мусор в настройке — значения по умолчанию", () => {
    expect(parseIceBreakers("{oops")).toEqual(defaultIceBreakers());
    expect(parseIceBreakers("null")).toEqual(defaultIceBreakers());
  });

  it("свой текст: одна строка, не длиннее 80 знаков, пустой — текст по умолчанию", () => {
    const cfg = parseIceBreakers(
      JSON.stringify({
        enabled: true,
        items: [
          { kind: "catalog", question: "  Что\nесть   в наличии?  " },
          { kind: "orders", question: "я".repeat(120) },
          { kind: "pay", question: "   " },
          { kind: "chat", question: "чужой вид" },
        ],
      }),
    );
    expect(cfg.items.map((i) => i.question)).toEqual([
      "Что есть в наличии?",
      "я".repeat(ICE_BREAKER_QUESTION_MAX),
      "Как оплатить",
      "Связаться с продавцом",
    ]);
    expect(cfg.items).toHaveLength(4);
  });

  it("эмодзи на границе 80 знаков не режется пополам", () => {
    const q = iceBreakerQuestion(`${"a".repeat(79)}😀`);
    expect(q).toBe("a".repeat(79));
  });
});

describe("быстрые вопросы Instagram: что ставить", () => {
  it("включены — четыре подсказки с payload IB:<вид>", () => {
    expect(iceBreakersFor(enabled(), DEFAULT_DIRECT_BOT, on)).toEqual([
      { question: "Каталог", payload: "IB:catalog" },
      { question: "Мои заказы", payload: "IB:orders" },
      { question: "Как оплатить", payload: "IB:pay" },
      { question: "Связаться с продавцом", payload: "IB:contact" },
    ]);
  });

  it("без магазина в Direct, без Instagram или с выключенным автоответчиком — ничего", () => {
    expect(iceBreakersFor(enabled(), DEFAULT_DIRECT_BOT, { instagram: true })).toEqual([]);
    expect(iceBreakersFor(enabled(), DEFAULT_DIRECT_BOT, { dm_shop: true })).toEqual([]);
    expect(iceBreakersFor(enabled(), { ...DEFAULT_DIRECT_BOT, enabled: false }, on)).toEqual([]);
  });

  it("выключенная часть магазина и снятая галочка — без своей подсказки", () => {
    const cfg = enabled();
    cfg.items[3]!.on = false;
    const bot = {
      ...DEFAULT_DIRECT_BOT,
      features: { ...DEFAULT_DIRECT_BOT.features, catalog: false, checkout: false },
    };
    expect(iceBreakersFor(cfg, bot, on).map((i) => i.payload)).toEqual(["IB:orders"]);
  });

  it("постбэк подсказки узнаётся, чужой — нет", () => {
    expect(iceBreakerKind("IB:pay")).toBe("pay");
    expect(iceBreakerKind("IB:other")).toBeNull();
    expect(iceBreakerKind("CATALOG")).toBeNull();
    expect(iceBreakerKind(null)).toBeNull();
  });
});
