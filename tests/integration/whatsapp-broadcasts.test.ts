import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT } from "./live";
import { serviceDb } from "@/core/db/client.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { setState, upsertCustomer, userKey } from "@/core/customers/customers";
import { getSetting, setSetting } from "@/core/settings/settings";
import {
  createBroadcast,
  parseExcludedPhones,
  resolveWhatsAppAudience,
} from "@/core/broadcasts/broadcasts";
import { applyTemplateStatus, listTemplates, templateParamCount } from "@/core/whatsapp/templates";
import {
  handleTemplateStatus,
  submitWhatsAppTemplate,
  syncWhatsAppTemplates,
  type TemplateApi,
} from "@/channels/zernio/templates.server";
import { runWhatsAppBroadcastBatch, type WhatsAppStarter } from "@/channels/zernio/jobs";

const ACCOUNT = "acc-wa-v2-probe";
const PHONE_OK = "77000009101";
const PHONE_BAD = "77000009102";
const PHONE_EXCLUDED = "77000009103";
const TPL = "v2_probe_template";
const EXCLUDED_KEY = "whatsapp_bot_excluded_phones";
let ctx: TenantContext;
let excludedBefore: string | null = null;

const fakeApi: TemplateApi = {
  list: async () => [
    {
      name: TPL,
      language: "ru",
      status: "APPROVED",
      category: "MARKETING",
      components: [{ type: "BODY", text: "Здравствуйте, {{1}}! Новинки: {{2}}." }],
      reason: "NONE",
    },
    { name: `${TPL}_kk`, language: "kk", status: "PENDING", category: "UTILITY" },
  ],
  create: async (input) => ({ ok: true, template: { ...input, status: "PENDING" } }),
};

async function cleanup() {
  const db = serviceDb();
  const { data: bs } = await db
    .from("broadcasts")
    .select("id")
    .eq("bot_id", DEMO_BOT)
    .eq("channel", "whatsapp")
    .like("template_name", `${TPL}%`);
  for (const b of bs ?? []) {
    await db.from("broadcast_recipients").delete().eq("broadcast_id", b.id);
    await db.from("broadcasts").delete().eq("id", b.id);
  }
  await db.from("whatsapp_templates").delete().eq("bot_id", DEMO_BOT).eq("account_id", ACCOUNT);
  await db
    .from("bot_users")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .in(
      "user_key",
      [PHONE_OK, PHONE_BAD, PHONE_EXCLUDED].map((p) => userKey("whatsapp", p)),
    );
}

describe.skipIf(!liveReady)("WhatsApp: шаблоны и рассылки на демо-клиенте", () => {
  beforeAll(async () => {
    // Модуль и аккаунт — в памяти: bots.settings демо-клиента не трогаем.
    const tenant = await requireTenant({ by: "id", value: DEMO_BOT });
    ctx = tenantContext({
      ...tenant,
      modules: { ...tenant.modules, whatsapp: true, wa_broadcasts: true },
      settings: {
        ...tenant.settings,
        zernio: {
          ...tenant.settings.zernio,
          accounts: [{ id: ACCOUNT, platform: "whatsapp", name: "Проба", expired: false }],
        },
      },
    });
    await cleanup();
    excludedBefore = await getSetting(ctx, EXCLUDED_KEY);
    // Аудитория — синтетическая страна ZZ: у демо-клиента жив деплой v1 с тем
    // же кроном рассылок, «всем» ушло бы настоящим людям.
    for (const phone of [PHONE_OK, PHONE_BAD, PHONE_EXCLUDED]) {
      const c = await upsertCustomer(ctx, "whatsapp", phone, {
        firstName: "Probe",
        contactPhone: `+${phone}`,
      });
      await setState(ctx, c, { mode: "idle", country_code: "ZZ", country_name: "Пробная" });
    }
  });

  afterAll(async () => {
    if (excludedBefore !== null) await setSetting(ctx, EXCLUDED_KEY, excludedBefore);
    else
      await serviceDb()
        .from("app_settings")
        .delete()
        .eq("bot_id", DEMO_BOT)
        .eq("key", EXCLUDED_KEY);
    await cleanup();
  });

  it("аудитория: номера из WhatsApp минус исключённые, «себе» пуста", async () => {
    await setSetting(ctx, EXCLUDED_KEY, `+7 700 000 91 03, 123`);
    expect(parseExcludedPhones("+7 700 000 91 03, 123")).toEqual(new Set([PHONE_EXCLUDED]));
    const phones = (await resolveWhatsAppAudience(ctx, "country", { country_code: "ZZ" }))
      .map((r) => r.phone)
      .sort();
    expect(phones).toEqual([PHONE_OK, PHONE_BAD]);
    expect(await resolveWhatsAppAudience(ctx, "test")).toEqual([]);
    const nonBuyers = await resolveWhatsAppAudience(ctx, "non_buyers");
    expect(nonBuyers.map((r) => r.phone)).toEqual(expect.arrayContaining([PHONE_OK]));
  });

  it("шаблоны: синхронизация, вердикт вебхуком, заявка", async () => {
    const s = await syncWhatsAppTemplates(ctx, ACCOUNT, fakeApi);
    expect(s).toMatchObject({ ok: true, count: 2 });
    const list = await listTemplates(ctx, ACCOUNT);
    expect(list.map((t) => [t.name, t.status, t.reason])).toEqual([
      [TPL, "APPROVED", null],
      [`${TPL}_kk`, "PENDING", null],
    ]);
    expect(templateParamCount(list[0]!.components)).toBe(2);

    // Чужой аккаунт — отказ без похода в API.
    expect((await syncWhatsAppTemplates(ctx, "acc-someone-else", fakeApi)).ok).toBe(false);

    // Вердикт по известному шаблону: обновление на месте, в `data`.
    const r1 = await handleTemplateStatus(
      ctx,
      {
        account: { accountId: ACCOUNT },
        data: { name: `${TPL}_kk`, language: "kk", status: "REJECTED", reason: "INVALID_FORMAT" },
      },
      fakeApi,
    );
    expect(r1.note).toContain("REJECTED");
    const kk = (await listTemplates(ctx, ACCOUNT)).find((t) => t.language === "kk");
    expect(kk?.status).toBe("REJECTED");
    expect(kk?.reason).toBe("INVALID_FORMAT");
    expect(
      await applyTemplateStatus(ctx, {
        accountId: ACCOUNT,
        name: "nope",
        language: "ru",
        status: "APPROVED",
      }),
    ).toBe(false);

    // Неизвестный шаблон — полная синхронизация (kk снова PENDING из «Meta»).
    const r2 = await handleTemplateStatus(
      ctx,
      {
        account: { id: ACCOUNT },
        template: { name: "made_in_manager", language: "en", status: "APPROVED" },
      },
      fakeApi,
    );
    expect(r2.note).toContain("синхронизировано");
    expect((await listTemplates(ctx, ACCOUNT)).find((t) => t.language === "kk")?.status).toBe(
      "PENDING",
    );

    // Заявка на шаблон: имя по правилам Meta, локально PENDING.
    const created = await submitWhatsAppTemplate(
      ctx,
      {
        accountId: ACCOUNT,
        name: "New Arrivals!",
        language: "ru",
        category: "MARKETING",
        body: "Привет, {{1}}",
      },
      fakeApi,
    );
    expect(created).toMatchObject({ ok: true, name: "new_arrivals" });
    const na = (await listTemplates(ctx, ACCOUNT)).find((t) => t.name === "new_arrivals");
    expect(na?.status).toBe("PENDING");
    expect(templateParamCount(na?.components)).toBe(1);
    expect(
      (
        await submitWhatsAppTemplate(
          ctx,
          { accountId: ACCOUNT, name: "!!!", language: "ru", category: "UTILITY", body: "x" },
          fakeApi,
        )
      ).ok,
    ).toBe(false);
  });

  it("рассылка шаблоном: проверки, пакет через Zernio, «не в WhatsApp» — отдельно", async () => {
    const off = tenantContext({
      ...ctx.tenant,
      modules: { ...ctx.tenant.modules, wa_broadcasts: false },
    });
    const base = {
      text: "",
      photoKeys: [],
      productIds: [],
      showCatalog: false,
      channel: "whatsapp" as const,
    };
    const noModule = await createBroadcast(off, { ...base, audience: "all" });
    expect(noModule.ok).toBe(false);
    const noTemplate = await createBroadcast(ctx, {
      ...base,
      audience: "all",
      whatsapp: {
        accountId: ACCOUNT,
        templateName: "",
        templateLanguage: "ru",
        templateParams: [],
      },
    });
    expect(noTemplate).toMatchObject({ ok: false, reason: "invalid" });
    expect(
      await createBroadcast(ctx, {
        ...base,
        audience: "test",
        whatsapp: {
          accountId: ACCOUNT,
          templateName: TPL,
          templateLanguage: "ru",
          templateParams: [],
        },
      }),
    ).toMatchObject({ ok: false, reason: "no_recipients" });

    const r = await createBroadcast(ctx, {
      ...base,
      audience: "country",
      filter: { country_code: "ZZ" },
      whatsapp: {
        accountId: ACCOUNT,
        templateName: TPL,
        templateLanguage: "ru",
        templateParams: ["Друг", "чай"],
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.broadcast.channel).toBe("whatsapp");
    expect(r.broadcast.total_count).toBe(2);
    expect(r.broadcast.message_text).toContain(TPL);

    // Вторая WhatsApp-рассылка параллельно — занято; Telegram при этом свободен.
    const busy = await createBroadcast(ctx, {
      ...base,
      audience: "country",
      filter: { country_code: "ZZ" },
      whatsapp: r.broadcast.template_name
        ? { accountId: ACCOUNT, templateName: TPL, templateLanguage: "ru", templateParams: [] }
        : undefined,
    });
    expect(busy).toMatchObject({ ok: false, reason: "busy" });

    const calls: Array<Parameters<WhatsAppStarter>[0]> = [];
    const start: WhatsAppStarter = async (p) => {
      calls.push(p);
      if (p.phone === PHONE_BAD)
        return {
          ok: false,
          error: "Zernio API 400: (#131021) Recipient is not a valid WhatsApp user",
        };
      return { ok: true, conversationId: "conv-1" };
    };
    expect(
      await runWhatsAppBroadcastBatch(
        { ...ctx.tenant, modules: { ...ctx.tenant.modules, wa_broadcasts: false } },
        start,
      ),
    ).toEqual({ skipped: "module off" });
    let done = false;
    for (let i = 0; i < 5 && !done; i++) {
      const b = await runWhatsAppBroadcastBatch(ctx.tenant, start);
      if ("skipped" in b) throw new Error(b.skipped);
      done = b.done;
    }
    expect(done).toBe(true);
    // Не ровно: крон v1 демо-клиента мог забрать часть получателей первым.
    for (const c of calls) {
      expect(c.accountId).toBe(ACCOUNT);
      expect(c.templateName).toBe(TPL);
      expect(c.templateLanguage).toBe("ru");
      expect(c.templateParams).toEqual(["Друг", "чай"]);
    }

    const { data: row } = await ctx.db
      .from("broadcasts")
      .select("*")
      .eq("id", r.broadcast.id)
      .single();
    expect(row?.status).toBe("completed");
    const { data: rec } = await ctx.db
      .from("broadcast_recipients")
      .select("phone, status, error_message")
      .eq("broadcast_id", r.broadcast.id);
    const byPhone = Object.fromEntries((rec ?? []).map((x) => [x.phone, x.status]));
    if (calls.some((c) => c.phone === PHONE_OK)) expect(byPhone[PHONE_OK]).toBe("sent");
    if (calls.some((c) => c.phone === PHONE_BAD)) {
      expect(byPhone[PHONE_BAD]).toBe("blocked");
      expect(row?.blocked_count).toBeGreaterThanOrEqual(1);
    }
  });
});
