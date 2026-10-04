import { describe, expect, it } from "vitest";
import {
  diagnoseTelegram,
  diagnoseZernio,
  type TelegramFacts,
  type ZernioFacts,
} from "./channel-diagnosis";
import { ZERNIO_WEBHOOK_EVENTS } from "@/channels/zernio/webhook-fit";

const now = new Date("2026-10-20T12:00:00Z");
const ago = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const EXPECTED = "https://app.example/api/telegram/webhook/bot-1";

const tg: TelegramFacts = {
  servedBy: "v2",
  tokenSet: true,
  me: { ok: true, username: "shop_bot" },
  webhook: {
    url: EXPECTED,
    expected: EXPECTED,
    pending: 0,
    lastErrorAt: null,
    lastErrorMessage: null,
  },
  lastEventAt: ago(1),
  now,
};
const T = (p: Partial<TelegramFacts>) => diagnoseTelegram({ ...tg, ...p });
const by = (d: { checks: { key: string; state: string; todo?: string }[] }, key: string) =>
  d.checks.find((c) => c.key === key)!;

describe("диагностика Telegram", () => {
  it("всё в порядке — вердикт ок, у пунктов нет «что сделать»", () => {
    const d = T({});
    expect(d.verdict).toBe("ok");
    expect(d.checks.every((c) => c.state !== "bad" && !c.todo)).toBe(true);
  });
  it("нет токена — не ок, дальше не идём", () => {
    const d = T({ tokenSet: false, me: null, webhook: null });
    expect(d.verdict).toBe("bad");
    expect(d.checks).toHaveLength(1);
    expect(by(d, "token").todo).toMatch(/BotFather/);
  });
  it("токен отвергнут (401) — не ок с советом заменить; обрыв сети — «не проверен», не «токен плохой»", () => {
    const a = T({ me: { ok: false, code: 401 }, webhook: null });
    expect(by(a, "alive").state).toBe("bad");
    expect(by(a, "alive").todo).toMatch(/Заменить/);
    const b = T({ me: { ok: false, code: null }, webhook: null });
    expect(by(b, "alive").state).toBe("bad");
    expect(by(b, "alive").todo).toMatch(/позже/);
    expect(by(b, "alive").todo).not.toMatch(/Заменить/);
  });
  it("вебхук на чужом адресе и не установлен — разные тексты, оба «Переустановить»", () => {
    const base = { pending: 0, lastErrorAt: null, lastErrorMessage: null, expected: EXPECTED };
    const other = T({ webhook: { ...base, url: "https://v1.example/hook" } });
    expect(by(other, "webhook").state).toBe("bad");
    expect(other.checks.find((c) => c.key === "webhook")!.detail).toMatch(/другому адресу/);
    const none = T({ webhook: { ...base, url: null } });
    expect(none.checks.find((c) => c.key === "webhook")!.detail).toMatch(/не установлен/);
    expect(by(none, "webhook").todo).toMatch(/Переустановить/);
  });
  it("свежая ошибка доставки — не ок, старая (больше суток) — в порядке", () => {
    const w = (h: number) => ({
      url: EXPECTED,
      expected: EXPECTED,
      pending: 3,
      lastErrorAt: ago(h),
      lastErrorMessage: "Wrong response from the webhook: 502",
    });
    const fresh = T({ webhook: w(2) });
    expect(by(fresh, "last-error").state).toBe("bad");
    expect(fresh.checks.find((c) => c.key === "last-error")!.detail).toMatch(/502/);
    expect(by(T({ webhook: w(30) }), "last-error").state).toBe("ok");
  });
  it("клиент на v1 — вебхук не проверяется и не краснеет", () => {
    const d = T({ servedBy: "v1", webhook: null, lastEventAt: null });
    expect(by(d, "webhook").state).toBe("info");
    expect(d.verdict).toBe("ok");
  });
  it("сбой ответа Telegram о вебхуке — не ок, а не «вебхук в порядке»", () => {
    const d = T({ webhook: { error: "timeout" } });
    expect(by(d, "webhook").state).toBe("bad");
  });
  it("нет событий в журнале — сведения, не поломка; журнал не прочитан — тоже", () => {
    expect(by(T({ lastEventAt: null }), "last-event").state).toBe("info");
    expect(by(T({ lastEventAt: undefined }), "last-event").state).toBe("info");
    expect(T({ lastEventAt: null }).verdict).toBe("ok");
  });
});

const zf: ZernioFacts = {
  servedBy: "v2",
  keySet: true,
  profileId: "prof-1",
  accounts: [{ id: "acc-1", username: "shop", expired: false }],
  live: { ok: true, accounts: [{ id: "acc-1", platform: "instagram", expired: false }] },
  webhook: { own: { active: true, profileIds: ["prof-1"], events: [...ZERNIO_WEBHOOK_EVENTS] } },
  lastEventAt: ago(3),
  lastFailed: null,
  now,
};
const Z = (p: Partial<ZernioFacts>, ch: "instagram" | "whatsapp" = "instagram") =>
  diagnoseZernio(ch, { ...zf, ...p });

describe("диагностика Instagram и WhatsApp", () => {
  it("всё в порядке — ок", () => {
    const d = Z({});
    expect(d.verdict).toBe("ok");
    expect(d.checks.every((c) => c.state !== "bad")).toBe(true);
  });
  it("нет ключа платформы — не ок и дальше не идём", () => {
    const d = Z({ keySet: false });
    expect(d.verdict).toBe("bad");
    expect(d.checks).toHaveLength(1);
    expect(d.checks[0]!.detail).toMatch(/ZERNIO_API_KEY/);
  });
  it("нет профиля — «Создать профиль»", () => {
    const d = Z({ profileId: null });
    expect(by(d, "profile").state).toBe("bad");
    expect(by(d, "profile").todo).toMatch(/Создать профиль/);
  });
  it("нет аккаунта этого канала и аккаунт с истёкшей авторизацией — разные причины", () => {
    const none = Z({ accounts: [], live: { ok: true, accounts: [] } });
    expect(by(none, "account").state).toBe("bad");
    expect(none.checks.find((c) => c.key === "account")!.detail).toMatch(/нет аккаунта Instagram/);
    const expired = Z({ accounts: [{ id: "acc-1", username: "shop", expired: true }] });
    expect(expired.checks.find((c) => c.key === "account")!.detail).toMatch(/истекла.*@shop/);
  });
  it("Zernio: ключ отвергнут (401) — про ключ; обрыв и 500 — «неизвестно», без обвинения ключа", () => {
    const auth = Z({
      live: { ok: false, failure: { status: 401 }, error: "x" },
    });
    expect(auth.checks.find((c) => c.key === "live")!.todo).toMatch(/ZERNIO_API_KEY/);
    for (const failure of [{ status: null }, { status: 500 }] as const) {
      const d = Z({ live: { ok: false, failure, error: "x" } });
      const live = d.checks.find((c) => c.key === "live")!;
      expect(live.state).toBe("bad");
      expect(live.detail).toMatch(/неизвестно/);
      expect(live.todo).not.toMatch(/ZERNIO_API_KEY/);
      expect(live.todo).toMatch(/не повторялось/);
    }
    const limited = Z({ live: { ok: false, failure: { status: 429 }, error: "x" } });
    expect(limited.checks.find((c) => c.key === "live")!.detail).toMatch(/частоту/);
  });
  it("аккаунта нет в Zernio (отключён там) и Zernio сообщает истёкшую авторизацию", () => {
    const gone = Z({ live: { ok: true, accounts: [] } });
    expect(gone.checks.find((c) => c.key === "live")!.detail).toMatch(/нет в Zernio/);
    const exp = Z({
      live: { ok: true, accounts: [{ id: "acc-1", platform: "instagram", expired: true }] },
    });
    expect(exp.checks.find((c) => c.key === "live")!.state).toBe("bad");
    // Аккаунт другого канала в профиле не считается аккаунтом этого.
    const wrongChannel = Z({
      live: { ok: true, accounts: [{ id: "acc-1", platform: "whatsapp", expired: false }] },
    });
    expect(wrongChannel.checks.find((c) => c.key === "live")!.state).toBe("bad");
  });
  it("вебхук: нет записи, выключена, профиль не привязан, не хватает событий", () => {
    const fix = /«Привязать»/;
    const none = Z({ webhook: { own: null } });
    expect(by(none, "webhook").state).toBe("bad");
    expect(by(none, "webhook").todo).toMatch(fix);
    const off = Z({ webhook: { own: { active: false, profileIds: ["prof-1"], events: [] } } });
    expect(off.checks.find((c) => c.key === "webhook")!.detail).toMatch(/выключена/);
    const other = Z({
      webhook: {
        own: { active: true, profileIds: ["prof-2"], events: [...ZERNIO_WEBHOOK_EVENTS] },
      },
    });
    expect(other.checks.find((c) => c.key === "webhook")!.detail).toMatch(/не входит/);
    const lack = Z({
      webhook: { own: { active: true, profileIds: ["prof-1"], events: ["message.received"] } },
    });
    expect(lack.checks.find((c) => c.key === "webhook")!.detail).toMatch(/message\.failed/);
    expect(Z({ webhook: { error: "403" } }).checks.find((c) => c.key === "webhook")!.state).toBe(
      "bad",
    );
  });
  it("клиент на v1 — вебхук не проверяется", () => {
    const d = Z({ servedBy: "v1", webhook: null });
    expect(by(d, "webhook").state).toBe("info");
    expect(d.verdict).toBe("ok");
  });
  it("последняя ошибка отправки: у WhatsApp свежий отказ — не ок, старый — сведения; у Instagram события нет вовсе", () => {
    const recent = Z(
      { lastFailed: { at: ago(48), reason: "номер не принимает сообщения" } },
      "whatsapp",
    );
    expect(by(recent, "send-error").state).toBe("bad");
    expect(recent.checks.find((c) => c.key === "send-error")!.detail).toMatch(/номер не принимает/);
    const old = Z({ lastFailed: { at: ago(24 * 10), reason: "x" } }, "whatsapp");
    expect(by(old, "send-error").state).toBe("info");
    const ig = Z({}, "instagram");
    expect(ig.checks.find((c) => c.key === "send-error")!.detail).toMatch(/не сообщает/);
  });
  it("нет событий — сведения, журнал не прочитан — сведения", () => {
    expect(by(Z({ lastEventAt: null }), "last-event").state).toBe("info");
    expect(by(Z({ lastEventAt: undefined }), "last-event").state).toBe("info");
  });
});
