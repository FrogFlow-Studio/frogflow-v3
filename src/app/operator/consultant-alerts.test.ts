import { describe, expect, it } from "vitest";
import {
  ALERT_EVERY_MS,
  classifyModelFailure,
  modelAlerts,
  modelAlertText,
  parseLastError,
  type ClientReading,
} from "./consultant-alerts";

const NOW = Date.parse("2026-09-27T21:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const billing = (min: number) =>
  `${ago(min)} — HTTP 400: 400 {"type":"error","error":{"message":"Your credit balance is too low to access the Anthropic API."}}`;
const client = (over: Partial<ClientReading>): ClientReading => ({
  id: "b1",
  name: "BOVI",
  enabled: true,
  lastError: null,
  ...over,
});

describe("вид сбоя модели по ошибке движка", () => {
  it("баланс, ключ, лимит; перегрузка, 5xx, сеть и прочее — не пишем", () => {
    expect(classifyModelFailure(parseLastError(billing(1))!.detail)).toBe("billing");
    expect(classifyModelFailure("HTTP 401: invalid x-api-key")).toBe("auth");
    expect(classifyModelFailure("HTTP 403: forbidden")).toBe("auth");
    expect(classifyModelFailure("HTTP 429: rate_limit_error")).toBe("limit");
    expect(classifyModelFailure("HTTP 529: overloaded")).toBeNull();
    expect(classifyModelFailure("HTTP 500: internal")).toBeNull();
    expect(classifyModelFailure("fetch failed")).toBeNull();
    expect(classifyModelFailure("лимит частоты вызовов ИИ; вопрос передан менеджеру")).toBeNull();
    expect(parseLastError("")).toBeNull();
  });
});

describe("когда писать оператору", () => {
  it("баланс кончился у двух клиентов — одно сообщение с обоими", () => {
    const a = modelAlerts(
      [
        client({ lastError: billing(5) }),
        client({ id: "b2", name: "Education Bot", lastError: billing(2) }),
        client({ id: "b3", name: "Выключен", enabled: false, lastError: billing(1) }),
      ],
      {},
      true,
      NOW,
    );
    expect(a).toEqual([{ kind: "billing", clients: ["BOVI", "Education Bot"], at: ago(2) }]);
    expect(modelAlertText(a[0]!)).toContain("закончились деньги");
  });

  it("не чаще раза в 3 часа на вид и только о сбое новее прошлого сообщения", () => {
    const c = [client({ lastError: billing(5) })];
    expect(modelAlerts(c, { billing: ago(60) }, true, NOW)).toEqual([]);
    // Прошло больше 3 часов, но сбой старый — тот же, о котором уже писали.
    expect(modelAlerts(c, { billing: ago(4) }, true, NOW + ALERT_EVERY_MS)).toEqual([]);
    const fresh = [client({ lastError: billing(1) })];
    expect(modelAlerts(fresh, { billing: ago(200) }, true, NOW)).toHaveLength(1);
    // Другой вид сбоя отметкой баланса не глушится.
    const auth = [client({ lastError: `${ago(1)} — HTTP 401: invalid x-api-key` })];
    expect(modelAlerts(auth, { billing: ago(10) }, true, NOW).map((x) => x.kind)).toEqual(["auth"]);
  });

  it("ключа платформы нет, а консультант у кого-то включён — «нет ключа»", () => {
    expect(modelAlerts([client({})], {}, false, NOW).map((x) => x.kind)).toEqual(["no_key"]);
    expect(modelAlerts([client({ enabled: false })], {}, false, NOW)).toEqual([]);
    expect(modelAlerts([client({})], { no_key: ago(30) }, false, NOW)).toEqual([]);
  });

  it("имя клиента экранируется", () => {
    const t = modelAlertText({ kind: "auth", clients: ["<b>A&B</b>"], at: ago(1) });
    expect(t).toContain("&lt;b&gt;A&amp;B&lt;/b&gt;");
  });
});
