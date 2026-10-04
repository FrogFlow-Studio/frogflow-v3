import { describe, expect, it } from "vitest";
import {
  addWorkingMinutes,
  averageResponse,
  minutesLabel,
  replyDue,
  targetMinutes,
  typicalHours,
  workingMinutesBetween,
  type ResponseSample,
} from "./response";

// Алматы = UTC+5. 2026-10-02 — пятница, 05.10 — понедельник (даты зашиты, «сегодня» не используется).
const loc = (day: string, hm: string) => `${day}T${hm}:00+05:00`;
const FRI = "2026-10-02";
const SAT = "2026-10-03";
const MON = "2026-10-05";

describe("рабочие минуты (пн–пт 10:00–19:00, Алматы)", () => {
  it("внутри рабочего дня — обычная разница", () => {
    expect(workingMinutesBetween(loc(MON, "10:30"), loc(MON, "12:00"))).toBe(90);
  });
  it("ночь и выходные не считаются: пятница вечером → понедельник утром", () => {
    expect(workingMinutesBetween(loc(FRI, "18:00"), loc(MON, "11:00"))).toBe(120);
  });
  it("до открытия считается с 10:00, после закрытия — до 19:00", () => {
    expect(workingMinutesBetween(loc(MON, "08:00"), loc(MON, "10:30"))).toBe(30);
    expect(workingMinutesBetween(loc(MON, "18:30"), loc(MON, "23:00"))).toBe(30);
  });
  it("только выходные — ноль; конец раньше начала — ноль", () => {
    expect(workingMinutesBetween(loc(SAT, "09:00"), loc("2026-10-04", "20:00"))).toBe(0);
    expect(workingMinutesBetween(loc(MON, "12:00"), loc(MON, "10:00"))).toBe(0);
  });
  it("целый рабочий день — 540 минут", () => {
    expect(workingMinutesBetween(loc(MON, "00:00"), loc("2026-10-06", "00:00"))).toBe(540);
  });
});

describe("срок ответа", () => {
  it("прибавляет рабочие минуты через выходные", () => {
    expect(addWorkingMinutes(loc(FRI, "18:30"), 120).toISOString()).toBe(
      new Date(loc(MON, "11:30")).toISOString(),
    );
    expect(addWorkingMinutes(loc(SAT, "12:00"), 60).toISOString()).toBe(
      new Date(loc(MON, "11:00")).toISOString(),
    );
  });
  it("цель по тарифу: Business быстрее, без плана — как Basic", () => {
    expect(targetMinutes("digital.business")).toBeLessThan(targetMinutes("digital.pro"));
    expect(targetMinutes("digital.pro")).toBeLessThan(targetMinutes("digital.basic"));
    expect(targetMinutes(null)).toBe(targetMinutes("digital.basic"));
  });
  const thread = (over: Record<string, string | null> = {}) => ({
    status: "new",
    created_at: loc(MON, "11:00"),
    last_seller_message_at: loc(MON, "11:00"),
    last_operator_message_at: null,
    first_response_at: null,
    due_at: null,
    ...over,
  });
  it("первый ответ: от создания обращения, цель по тарифу; просрочка считается по часам", () => {
    const r = replyDue(thread(), "digital.business", new Date(loc(MON, "12:00")))!;
    expect(r.due).toBe(new Date(loc(MON, "13:00")).toISOString());
    expect(r.overdue).toBe(false);
    expect(replyDue(thread(), "digital.business", new Date(loc(MON, "13:01")))!.overdue).toBe(true);
  });
  it("повторное сообщение после ответа — от последнего сообщения продавца", () => {
    const t = thread({
      first_response_at: loc(MON, "11:30"),
      last_operator_message_at: loc(MON, "11:30"),
      last_seller_message_at: loc(MON, "15:00"),
    });
    expect(replyDue(t, "digital.pro", new Date(loc(MON, "15:10")))!.due).toBe(
      new Date(loc(MON, "19:00")).toISOString(),
    );
  });
  it("срок, выставленный оператором (due_at), главнее расчёта", () => {
    const due = loc(MON, "16:00");
    expect(
      replyDue(thread({ due_at: due }), "digital.basic", new Date(loc(MON, "12:00")))!.due,
    ).toBe(due);
  });
  it("оператор ответил, решено или продавец ещё не писал — таймера нет", () => {
    expect(
      replyDue(thread({ last_operator_message_at: loc(MON, "11:30") }), null, new Date()),
    ).toBeNull();
    expect(replyDue(thread({ status: "resolved" }), null, new Date())).toBeNull();
    expect(replyDue(thread({ last_seller_message_at: null }), null, new Date())).toBeNull();
  });
});

describe("сводка и «обычно отвечаем»", () => {
  const NOW = new Date(loc("2026-10-09", "12:00"));
  // Обращение в понедельник 10:00, ответ через `m` рабочих минут.
  const sample = (day: string, m: number): ResponseSample => ({
    startedAt: loc(day, "10:00"),
    respondedAt: new Date(new Date(loc(day, "10:00")).getTime() + m * 60_000).toISOString(),
  });
  it("среднее за неделю по моменту ответа; за пределами недели не входит", () => {
    const s = [sample("2026-10-05", 60), sample("2026-10-06", 120), sample("2026-09-21", 500)];
    expect(averageResponse(s, NOW, 7)).toEqual({ count: 2, avgMinutes: 90 });
    expect(averageResponse([], NOW, 7)).toEqual({ count: 0, avgMinutes: null });
  });
  it("мало обращений — цифры нет", () => {
    expect(typicalHours([sample(MON, 30), sample(MON, 60)], NOW)).toBeNull();
  });
  it("80-й процентиль вверх до часа: редкий долгий ответ не поднимает цифру, но обещание не ниже факта", () => {
    const s = [30, 60, 90, 120, 480].map((m) => sample("2026-10-05", m));
    expect(typicalHours(s, NOW)).toBe(2);
    const fast = [5, 10, 15, 20, 25].map((m) => sample("2026-10-05", m));
    expect(typicalHours(fast, NOW)).toBe(1);
  });
  it("старше 30 дней в «обычно» не входит", () => {
    const old = [30, 60, 90, 120, 130].map((m) => sample("2026-08-03", m));
    expect(typicalHours(old, NOW)).toBeNull();
  });
  it("подпись минут", () => {
    expect(minutesLabel(45)).toBe("45 мин");
    expect(minutesLabel(135)).toBe("2 ч 15 мин");
    expect(minutesLabel(120)).toBe("2 ч");
  });
});
