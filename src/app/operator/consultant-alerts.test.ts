import { describe, expect, it } from "vitest";
import {
  ALERT_EVERY_MS,
  classifyModelFailure,
  isTransientFailure,
  modelAlerts,
  outageAlertText,
  outageStep,
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

describe("затяжной сбой Anthropic", () => {
  const at = (min: number, detail = "HTTP 529: overloaded_error") => `${ago(min)} — ${detail}`;

  it("временные сбои: 5xx, 529, обрыв и тайм-аут; баланс и ключ — нет", () => {
    expect(isTransientFailure("HTTP 529: overloaded")).toBe(true);
    expect(isTransientFailure("HTTP 500: internal server error")).toBe(true);
    expect(isTransientFailure("HTTP ?: Request timed out.")).toBe(true);
    expect(isTransientFailure("HTTP ?: Connection error.")).toBe(true);
    expect(isTransientFailure("не уложился в потолок времени; вопрос передан менеджеру")).toBe(
      true,
    );
    expect(isTransientFailure("HTTP 400: Your credit balance is too low")).toBe(false);
    expect(isTransientFailure("HTTP 401: invalid x-api-key")).toBe(false);
    expect(isTransientFailure("HTTP 400: bad request")).toBe(false);
    expect(isTransientFailure("лимит частоты вызовов ИИ; вопрос передан менеджеру")).toBe(false);
  });

  it("первый сбой — только отметка; держится 30 мин при входящих — сообщить один раз", () => {
    const first = outageStep([client({ lastError: at(40) })], {}, new Set(), NOW - 39 * 60_000);
    expect(first.due).toEqual([]);
    expect(first.next.b1).toEqual({ since: ago(40), last: ago(40) });
    const mid = outageStep(
      [client({ lastError: at(22) })],
      first.next,
      new Set(),
      NOW - 20 * 60_000,
    );
    expect(mid.due).toEqual([]);
    const later = outageStep([client({ lastError: at(5) })], mid.next, new Set(), NOW);
    expect(later.due).toEqual(["b1"]);
    const sent = { b1: { ...later.next.b1!, sent: ago(0) } };
    const again = outageStep([client({ lastError: at(1) })], sent, new Set(), NOW + 15 * 60_000);
    expect(again.due).toEqual([]);
    expect(again.next.b1!.sent).toBe(ago(0));
  });

  it("удачный ответ между прогонами — эпизод заново", () => {
    const prev = { b1: { since: ago(40), last: ago(25) } };
    const r = outageStep([client({ lastError: at(5) })], prev, new Set(["b1"]), NOW);
    expect(r.due).toEqual([]);
    expect(r.next.b1).toEqual({ since: ago(5), last: ago(5) });
  });

  it("старый сбой без новых входящих — не тревога; ошибка стёрлась — эпизод закрыт", () => {
    const prev = { b1: { since: ago(120), last: ago(80) } };
    expect(outageStep([client({ lastError: at(80) })], prev, new Set(), NOW).due).toEqual([]);
    expect(outageStep([client({ lastError: "" })], prev, new Set(), NOW).next).toEqual({});
    // Новый сбой через час тишины — новый эпизод, а не «сбой два часа».
    const r = outageStep([client({ lastError: at(1) })], prev, new Set(), NOW);
    expect(r.due).toEqual([]);
    expect(r.next.b1!.since).toBe(ago(1));
  });

  it("консультант выключен или сбой не временный — не следим", () => {
    expect(
      outageStep([client({ enabled: false, lastError: at(1) })], {}, new Set(), NOW).next,
    ).toEqual({});
    expect(outageStep([client({ lastError: billing(1) })], {}, new Set(), NOW).next).toEqual({});
  });

  it("текст: с какого времени, клиенты, куда смотреть", () => {
    const t = outageAlertText(["BOVI <1>"], "2026-10-08T10:05:00.000Z");
    expect(t).toContain("больше 30 минут");
    expect(t).toContain("10:05 UTC");
    expect(t).toContain("BOVI &lt;1&gt;");
    expect(t).toContain("status.anthropic.com");
  });
});
