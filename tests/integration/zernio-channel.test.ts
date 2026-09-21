import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT } from "./live";
import { serviceDb } from "@/core/db/client.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { getCustomer, syntheticTelegramId, userKey } from "@/core/customers/customers";
import { connect, listConversations, listMessages } from "@/core/chat/chat";
import { getSetting, setSetting } from "@/core/settings/settings";
import { handleZernioMessage } from "@/channels/zernio/handle-message";
import type { ZernioTransport } from "@/channels/zernio/api.server";

/**
 * Канал Instagram/WhatsApp на демо-клиенте без похода в Zernio: транспорт
 * подменён. Проверяется то, что держится на базе — покупатель с
 * синтетическим telegram_id, диалог в «Чате», перехват менеджером.
 */
const SENDER = "990000777001"; // синтетический отправитель Instagram
const KEY = userKey("instagram", SENDER);
const TG = syntheticTelegramId(KEY);
let ctx: TenantContext;
let prevConsultant: string | null = null;
const sent: string[] = [];
const fake: ZernioTransport = {
  send: async (_c, _a, text) => {
    sent.push(text);
    return { ok: true };
  },
  tail: async () => [],
};

function event(id: string, text: string) {
  return {
    id,
    event: "message.received",
    account: { accountId: "acc-demo", platform: "instagram" },
    message: {
      conversationId: "conv-demo",
      text,
      sender: { id: SENDER, name: "Проба Директ", username: "probe_direct" },
      direction: "incoming",
    },
  };
}

async function cleanup() {
  const db = serviceDb();
  await db.from("manager_chat_messages").delete().eq("bot_id", DEMO_BOT).eq("telegram_id", TG);
  await db.from("manager_chat_state").delete().eq("bot_id", DEMO_BOT).eq("telegram_id", TG);
  await db.from("bot_users").delete().eq("bot_id", DEMO_BOT).eq("user_key", KEY);
}

describe.skipIf(!liveReady)("канал Instagram/WhatsApp на демо-клиенте", () => {
  beforeAll(async () => {
    const tenant = await requireTenant({ by: "id", value: DEMO_BOT });
    ctx = tenantContext({
      ...tenant,
      modules: { ...tenant.modules, instagram: true, whatsapp: true, manager_chat: true },
    });
    prevConsultant = await getSetting(ctx, "consultant_enabled");
    await setSetting(ctx, "consultant_enabled", "false");
    await cleanup();
  });
  afterAll(async () => {
    await setSetting(ctx, "consultant_enabled", prevConsultant ?? "");
    await cleanup();
  });

  it("покупатель из Direct получает синтетический отрицательный telegram_id и диалог Zernio", async () => {
    const r = await handleZernioMessage(ctx, event("evt-1", "Здравствуйте, есть доставка?"), fake);
    expect(r.status).toBe("processed");
    const c = await getCustomer(ctx, KEY);
    expect(c?.platform).toBe("instagram");
    expect(c?.telegramId).toBe(TG);
    expect(TG).toBeLessThan(0);
    expect(c?.zernioConversationId).toBe("conv-demo");
    expect(c?.zernioAccountId).toBe("acc-demo");
    expect(c?.username).toBe("probe_direct");
    // Без консультанта бот молчит, но реплика видна продавцу в «Чате».
    expect(sent).toEqual([]);
    const conv = (await listConversations(ctx)).find((x) => x.telegram_id === TG);
    expect(conv?.platform).toBe("instagram");
    expect(conv?.user_key).toBe(KEY);
    expect(conv?.last_message_preview).toBe("Здравствуйте, есть доставка?");
  });

  it("менеджер подключился в панели — сообщение перехватывается и остаётся в переписке", async () => {
    await connect(ctx, TG);
    const r = await handleZernioMessage(ctx, event("evt-2", "Мне нужен букет к пятнице"), fake);
    expect(r.status).toBe("processed");
    expect(r.note).toMatch(/менеджер/);
    const texts = (await listMessages(ctx, TG)).map((m) => m.text);
    expect(texts).toContain("Мне нужен букет к пятнице");
  });

  it("исходящее и чужая платформа без модуля отбиваются, а не доходят до покупателя", async () => {
    const out = await handleZernioMessage(
      ctx,
      {
        ...event("evt-3", "наш ответ"),
        message: { ...event("evt-3", "x").message, direction: "outgoing" },
      },
      fake,
    );
    expect(out.status).toBe("ignored");
    const off = await handleZernioMessage(
      tenantContext({ ...ctx.tenant, modules: { ...ctx.tenant.modules, whatsapp: false } }),
      { ...event("evt-4", "привет"), account: { accountId: "acc-demo", platform: "whatsapp" } },
      fake,
    );
    expect(off.status).toBe("ignored");
    expect(off.note).toMatch(/WhatsApp/);
  });
});
