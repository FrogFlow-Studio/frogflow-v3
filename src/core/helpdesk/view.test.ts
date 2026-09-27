import { describe, expect, it } from "vitest";
import { historyLine } from "./view";

const dict: Record<string, string> = {
  "tickets.h.customer": "покупатель",
  "tickets.h.opened": "обращение создано",
  "tickets.h.message": "покупатель дописал",
  "tickets.h.note": "заметка",
  "tickets.h.status": "статус: {status}",
  "tickets.h.assignee": "ответственный: {who}",
  "tickets.status.waiting": "Ждём покупателя",
  "tickets.status.closed": "Закрыто",
};
const t = (k: string, v: Record<string, string> = {}) =>
  (dict[k] ?? k).replace(/\{(\w+)\}/g, (_, n: string) => v[n] ?? "");
const who = (u: string | null) => (u ? `Анна (${u})` : "Не назначен");
const at = "2026-09-27T10:00:00Z";

describe("строка истории обращения", () => {
  it("действия покупателя и команды — по-человечески", () => {
    expect(historyLine({ at, actor: "customer", action: "opened" }, t, who)).toBe(
      "покупатель: обращение создано",
    );
    expect(
      historyLine({ at, actor: "customer", action: "message", note: "Заказ №5" }, t, who),
    ).toBe("покупатель: покупатель дописал — Заказ №5");
    expect(historyLine({ at, actor: "admin:owner", action: "status:closed" }, t, who)).toBe(
      "owner: статус: Закрыто",
    );
    expect(historyLine({ at, actor: "admin:owner", action: "assignee:anna" }, t, who)).toBe(
      "owner: ответственный: Анна (anna)",
    );
    expect(historyLine({ at, actor: "admin:owner", action: "assignee:-" }, t, who)).toBe(
      "owner: ответственный: Не назначен",
    );
  });

  it("старый статус pending показывается как «Ждём покупателя»", () => {
    expect(historyLine({ at, actor: "admin:anna", action: "status:pending" }, t, who)).toBe(
      "anna: статус: Ждём покупателя",
    );
  });
});
