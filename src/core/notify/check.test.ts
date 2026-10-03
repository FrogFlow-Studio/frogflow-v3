import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { claimNotifyCheck, runNotifyCheck, type CheckDeps } from "./check";
import { defaultNotifyPrefs } from "./prefs";

const deps = (over: Partial<CheckDeps> = {}): CheckDeps => ({
  hasBot: true,
  recipients: ["1", "2"],
  sendTelegram: async () => ({ ok: true }),
  mailConfigured: true,
  sendMail: async () => ({ ok: true }),
  pushConfigured: false,
  sendPush: async () => 0,
  ...over,
});

describe("проверка уведомлений продавца", () => {
  it("каждому получателю отдельно: один заблокировал бота, другой получил", async () => {
    const lines = await runNotifyCheck(
      defaultNotifyPrefs(),
      deps({
        sendTelegram: async (id) =>
          id === "1"
            ? { ok: false, description: "Forbidden: bot was blocked by the user" }
            : { ok: true },
      }),
    );
    expect(lines).toEqual([
      { channel: "telegram", target: "1", ok: false, code: "blocked" },
      { channel: "telegram", target: "2", ok: true, code: "ok" },
    ]);
  });

  it("неверный чат, обрыв и неизвестная причина различаются", async () => {
    const answers: Record<string, string> = {
      "1": "Bad Request: chat not found",
      "2": "fetch failed",
      "3": "Bad Request: something new",
    };
    const lines = await runNotifyCheck(
      defaultNotifyPrefs(),
      deps({
        recipients: ["1", "2", "3"],
        sendTelegram: async (id) => ({ ok: false, description: answers[id] }),
      }),
    );
    expect(lines.map((l) => l.code)).toEqual(["chat_not_found", "no_answer", "other"]);
    expect(lines[2]!.detail).toBe("Bad Request: something new");
  });

  it("нет бота или получателей — это итог, а не молчание", async () => {
    expect((await runNotifyCheck(defaultNotifyPrefs(), deps({ hasBot: false })))[0]!.code).toBe(
      "no_bot",
    );
    expect((await runNotifyCheck(defaultNotifyPrefs(), deps({ recipients: [] })))[0]!.code).toBe(
      "no_recipients",
    );
  });

  it("почту проверяет только если выбрана; без SMTP — «не настроена»", async () => {
    const off = await runNotifyCheck(defaultNotifyPrefs(), deps());
    expect(off.some((l) => l.channel === "email")).toBe(false);
    const p = defaultNotifyPrefs();
    p.kinds.new_order.email = true;
    p.email = "a@b.kz";
    const noSmtp = await runNotifyCheck(p, deps({ mailConfigured: false }));
    expect(noSmtp.find((l) => l.channel === "email")).toMatchObject({
      ok: false,
      code: "mail_off",
    });
    const noAddr = await runNotifyCheck({ ...p, email: "" }, deps());
    expect(noAddr.find((l) => l.channel === "email")?.code).toBe("mail_no_address");
    const bad = await runNotifyCheck(
      p,
      deps({ sendMail: async () => ({ ok: false, error: "auth failed" }) }),
    );
    expect(bad.find((l) => l.channel === "email")).toMatchObject({
      ok: false,
      code: "mail_failed",
      detail: "auth failed",
    });
    const good = await runNotifyCheck(p, deps());
    expect(good.find((l) => l.channel === "email")).toMatchObject({ ok: true, target: "a@b.kz" });
  });

  it("push: строки нет, если платформа его не умеет; без устройств — отдельный итог", async () => {
    expect(
      (await runNotifyCheck(defaultNotifyPrefs(), deps())).some((l) => l.channel === "push"),
    ).toBe(false);
    const none = await runNotifyCheck(
      defaultNotifyPrefs(),
      deps({ pushConfigured: true, sendPush: async () => 0 }),
    );
    expect(none.find((l) => l.channel === "push")).toMatchObject({ ok: false, code: "push_none" });
    const two = await runNotifyCheck(
      defaultNotifyPrefs(),
      deps({ pushConfigured: true, sendPush: async () => 2 }),
    );
    expect(two.find((l) => l.channel === "push")).toMatchObject({ ok: true, target: "2" });
  });
});

describe("claimNotifyCheck — предел общий для экземпляров", () => {
  const mk = () =>
    ({
      tenant: { id: "11111111-1111-1111-1111-111111111111" },
      db: fakeDb({ unique: { app_settings: [["bot_id", "key"]] } }),
    }) as unknown as TenantContext;
  it("из пяти одновременных запусков проходит один, через 20 с — снова можно", async () => {
    const ctx = mk();
    const now = 1_000_000;
    const res = await Promise.all(Array.from({ length: 5 }, () => claimNotifyCheck(ctx, now)));
    expect(res.filter(Boolean)).toHaveLength(1);
    expect(await claimNotifyCheck(ctx, now + 19_000)).toBe(false);
    expect(await claimNotifyCheck(ctx, now + 20_000)).toBe(true);
  });
});
