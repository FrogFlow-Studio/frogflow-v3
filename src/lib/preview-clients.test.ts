import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setEnvForTests } from "@/config/env";
import { PREVIEW_SEND_OFF } from "@/lib/preview";

/** Файлы `src/`, кроме тестов и сгенерированного. */
function sources(dir = "src"): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.|\.gen\./.test(e.name) ? [p] : [];
  });
}

/** Что считается внешним клиентом с расходом или побочным эффектом, и как его узнать в коде. */
const CLIENT_MARKERS: { what: string; marker: RegExp }[] = [
  { what: "Anthropic", marker: /new Anthropic\(/ },
  { what: "Google Vision", marker: /vision\.googleapis\.com/ },
  { what: "ApiPay", marker: /\/invoices\/qr/ },
  { what: "ApiPay (партнёр)", marker: /"X-Partner-Key"/ },
  { what: "web push", marker: /authorization: vapidAuthorization/ },
  { what: "Telegram Bot API", marker: /\/bot\$\{token\}\/\$\{method\}/ },
  { what: "Zernio", marker: /Authorization: `Bearer \${apiKey}`/ },
  { what: "почта (SMTP)", marker: /createTransport\(|net\.connect\(|tls\.connect\(/ },
];

/** Осознанные исключения: клиент не смотрит `previewReadonly()`. Сейчас таких нет. */
const EXCEPTIONS: Record<string, string> = {};

describe("предпросмотр: каждый внешний клиент смотрит previewReadonly()", () => {
  const files = sources().map((f) => ({ f, text: readFileSync(f, "utf8") }));

  for (const { what, marker } of CLIENT_MARKERS) {
    it(`${what}: все места вызова проверяют previewReadonly()`, () => {
      const hits = files.filter((x) => marker.test(x.text));
      expect(hits.length, `маркер ${what} не найден — обновите тест`).toBeGreaterThan(0);
      const bare = hits.filter((x) => !EXCEPTIONS[x.f] && !/previewReadonly\(\)/.test(x.text));
      expect(bare.map((x) => x.f)).toEqual([]);
    });
  }

  it("все места new Anthropic( известны: проверяют предпросмотр или названы исключением", () => {
    const hits = files.filter((x) => /new Anthropic\(/.test(x.text)).map((x) => x.f);
    // Вызов модели ставит бронь ИИ-баланса раньше клиента: проверка стоит выше,
    // поэтому достаточно previewReadonly() в том же файле (см. тест выше), а
    // исключения — только лиды оператора.
    for (const f of hits)
      expect(EXCEPTIONS[f] || /previewReadonly\(\)/.test(readFileSync(f, "utf8")), f).toBeTruthy();
  });

  it("исключения не устарели: файл существует и действительно без проверки", () => {
    for (const f of Object.keys(EXCEPTIONS)) {
      const text = files.find((x) => x.f === f)?.text;
      expect(text, `${f} нет — уберите из EXCEPTIONS`).toBeDefined();
      expect(text, `${f} уже проверяет предпросмотр — уберите из EXCEPTIONS`).not.toMatch(
        /previewReadonly\(\)/,
      );
    }
  });
});

afterEach(() => {
  setEnvForTests(undefined);
  vi.restoreAllMocks();
});

describe("предпросмотр: клиент не доходит до сети", () => {
  it("ApiPay: счёт не выставляется и причина понятна", async () => {
    setEnvForTests({ PREVIEW_READONLY: "1" });
    const { apipayProvider } = await import("@/core/billing/pay/apipay");
    const fetchImpl = vi.fn();
    const p = apipayProvider(
      { apiKey: "k", baseUrl: "https://apipay.test", live: true, sandboxBotId: "b" } as never,
      fetchImpl as never,
    );
    const req = { amount: 1000, currency: "KZT", botId: "b", invoiceId: "i", note: "n" } as never;
    expect(await p.unavailable(req)).toBe(PREVIEW_SEND_OFF);
    await expect(p.issue(req)).rejects.toThrow("Предпросмотр");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("push: ни одна подписка не получает сообщение", async () => {
    setEnvForTests({ PREVIEW_READONLY: "1" });
    const { sendWebPush } = await import("@/core/push/webpush");
    const fetchImpl = vi.fn();
    const sub = {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      p256dh: "x",
      auth: "y",
    };
    const r = await sendWebPush(
      sub as never,
      { t: 1 },
      { publicKey: "a", privateKey: "b", subject: "mailto:a@b.c" } as never,
      fetchImpl as never,
    );
    expect(r).toBe("failed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ИИ-помощник: понятная ошибка «предпросмотр», а не «нет ключа»", async () => {
    setEnvForTests({ PREVIEW_READONLY: "1", ANTHROPIC_API_KEY: "sk-test" });
    const { assistText } = await import("@/core/assistant/assistant.server");
    await expect(
      assistText({} as never, { task: "title", product: { name: "Книга" }, lang: "ru" } as never),
    ).rejects.toMatchObject({
      key: "err.assist.preview",
      message: expect.stringContaining("Предпросмотр"),
    });
  });

  it("консультант и умный поиск: в предпросмотре «ИИ недоступен», клиент модели не создаётся", async () => {
    setEnvForTests({ PREVIEW_READONLY: "1", ANTHROPIC_API_KEY: "sk-test" });
    const ctor = vi.fn();
    vi.doMock("@anthropic-ai/sdk", () => ({ default: ctor, Anthropic: ctor }));
    const smart = await import("@/core/search/smart.server");
    expect(await smart.smartSearchProductIds({} as never, "тетрадь")).toBeNull();
    expect(ctor).not.toHaveBeenCalled();
    vi.doUnmock("@anthropic-ai/sdk");
  });
});
