import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { settingsFromJson } from "@/core/tenant/directory";
import type { ConsultantProduct } from "@/core/consultant/pricelist/catalog";
import type { ZernioTransport } from "./api.server";
import { handoffProductLines, openDialogMarkup, productLine } from "./handoff-card";

/**
 * Карточка передачи менеджеру с товарами разговора и кнопкой диалога
 * (v1 consultant/notify.ts:75-121).
 */
const ZT: ConsultantProduct = {
  id: "zt",
  name: "Uchino Полотенце махровое Zero Twist, 70x140, цвет белый",
  category: "Полотенца",
  size: "70x140",
  colors: ["белый"],
  price_kzt: 55000,
  stock: true,
};
const PILLOW: ConsultantProduct = {
  id: "p1",
  name: "Подушка Dorelan",
  category: "Подушки",
  size: "50x70",
  colors: [],
  price_kzt: 42000,
  stock: true,
};

describe("товары в карточке", () => {
  it("название, размер (если его нет в названии), цвет и цена в тенге", () => {
    expect(productLine(PILLOW)).toBe("Подушка Dorelan 50x70 (42 000 ₸)");
    expect(productLine({ ...PILLOW, colors: ["серый", "белый"] })).toMatch(
      /^Подушка Dorelan 50x70, серый\/белый \(42.000 ₸\)$/,
    );
    expect(productLine(ZT)).toBe(
      "Uchino Полотенце махровое Zero Twist, 70x140, цвет белый (55\u00a0000 ₸)",
    );
  });

  it("один товар — строкой, несколько — списком; неизвестные коды и повторы пропадают", () => {
    expect(handoffProductLines(["p1"], [ZT, PILLOW], "ru")).toEqual([
      "🏷 Товар: Подушка Dorelan 50x70 (42 000 ₸)",
    ]);
    const many = handoffProductLines(["zt", "gone", "p1", "zt"], [ZT, PILLOW], "en");
    expect(many[0]).toBe("🏷 Products:");
    expect(many).toHaveLength(3);
    expect(handoffProductLines(["gone"], [ZT], "ru")).toEqual([]);
    expect(handoffProductLines(undefined, [ZT], "ru")).toEqual([]);
  });

  it("кнопка: ig.me по нику, входящие Direct без ника, wa.me по номеру", () => {
    expect(openDialogMarkup("instagram", { username: "@anya.k" }, "ru")).toEqual({
      inline_keyboard: [[{ text: "💬 Открыть диалог в Instagram", url: "https://ig.me/m/anya.k" }]],
    });
    expect(openDialogMarkup("instagram", {}, "kk")!.inline_keyboard[0]![0]!.url).toBe(
      "https://www.instagram.com/direct/inbox/",
    );
    expect(openDialogMarkup("whatsapp", { phone: "+7 (700) 111-22-33" }, "uz")).toEqual({
      inline_keyboard: [
        [{ text: "💬 WhatsApp’da chatni ochish", url: "https://wa.me/77001112233" }],
      ],
    });
    expect(openDialogMarkup("whatsapp", {}, "en")).toBeUndefined();
  });
});

// ── Настоящий путь handleZernioMessage: консультант передал диалог — что увидел продавец ──
const notices: Array<{ html: string; opts: Record<string, unknown> }> = [];
vi.mock("@/channels/telegram/notify", () => ({
  notifyAdminsHtml: vi.fn(async (_c: unknown, html: string, opts: Record<string, unknown>) => {
    notices.push({ html, opts });
    return 1;
  }),
}));
vi.mock("@/core/consultant/engine.server", () => ({
  consultantEnabled: async () => true,
  isPaused: () => false,
  pauseConsultant: async () => {},
  runConsultant: vi.fn(async (ctx: TenantContext, c: { userKey: string }) => {
    // Как finish в движке: товары последнего ответа — в состояние диалога.
    const db = ctx.db as unknown as { tables: Record<string, Array<Record<string, unknown>>> };
    const row = db.tables.bot_users!.find((r) => r.user_key === c.userKey)!;
    const state = row.state as Record<string, Record<string, unknown>>;
    row.state = { ...state, consultant: { ...state.consultant, last_product_ids: ["p1", "zt"] } };
    return {
      reply: "Передаю менеджеру.",
      handoff: { kind: "lead", reason: "purchase", summary: "Хочет купить подушку" },
      usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
    };
  }),
}));
vi.mock("@/core/pipeline/sources", () => ({ leadFromHandoff: async () => {} }));
vi.mock("@/core/consultant/runs", () => ({ recordConsultantRun: async () => {} }));
vi.mock("@/core/consultant/relay", () => ({
  issueHandoffRef: async () => null,
  handoffRefLine: () => "",
}));

describe("карточка передачи из Direct", () => {
  it("в карточке — товары разговора и кнопка «Открыть диалог в Instagram»", async () => {
    const { handleZernioMessage } = await import("./handle-message");
    const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
    db.tables.bot_users = [];
    db.tables.blocked_users = [];
    db.tables.products = [];
    db.tables.app_settings = [
      { bot_id: "b1", key: "consultant_catalog_json", value: JSON.stringify([ZT, PILLOW]) },
    ];
    const ctx = {
      tenant: {
        id: `card-${Math.random()}`,
        name: "BOVI",
        status: "active",
        vertical: "consultant",
        modules: { instagram: true },
        settings: settingsFromJson({ consultant_pricelist: { enabled: true } }),
      },
      db,
      timezone: "Asia/Almaty",
    } as unknown as TenantContext;
    const transport = {
      send: vi.fn(async () => ({ ok: true })),
      tail: async () => [],
    } as unknown as ZernioTransport;
    notices.length = 0;
    const r = await handleZernioMessage(
      ctx,
      {
        account: { platform: "instagram", accountId: "acc-1" },
        conversation: { id: "conv-1" },
        message: {
          text: "Беру подушку",
          sender: { id: "555", name: "Аня", username: "anya.k" },
        },
      } as never,
      transport,
    );
    expect(r.status).toBe("processed");
    const card = notices.find((n) => n.opts.kind === "lead")!;
    expect(card.html).toContain("Хочет купить подушку");
    expect(card.html).toContain("🏷 Товары:");
    expect(card.html).toContain("Подушка Dorelan 50x70 (42 000 ₸)");
    expect(card.html).toContain("Zero Twist");
    expect(card.opts.replyMarkup).toEqual({
      inline_keyboard: [[{ text: "💬 Открыть диалог в Instagram", url: "https://ig.me/m/anya.k" }]],
    });
  });
});
