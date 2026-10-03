import { describe, expect, it } from "vitest";
import { describeOrderEvent } from "@/core/orders/events";
import { CHAT_KEY_PREFIX } from "./channel.server";
import { CURATOR_KEY_PREFIX } from "./curators.server";
import { courseKey, parseCourse } from "./course";
import { parseRun, runKey } from "./run.server";
import { courseTimeline } from "./cohort";

/**
 * Совместимость данных школы с v2 — на случай отката (docs/SWITCH-V3.md,
 * «Откат»). v3 пишет в те же `app_settings` и `order_events`, что и v2, но
 * часть полей v2 не знает: он их молча теряет при перезаписи или не учитывает.
 * Реестр ниже — полный перечень таких полей; тест держит его честным: каждое
 * поле реально сохраняется v3, а то, что v2 теряет, названо вслух. Появилось
 * новое поле, которого v2 не знает, — допишите его сюда и в раздел «Откат».
 *
 * Правки v2 под откат (parseRun сохраняет неизвестные поля, крон окончания
 * учитывает `until`) не сделаны: v2 заморожен, правим только по слову Якова.
 */
export const V3_ONLY = {
  "run.until":
    "v2 снимет доступ к каналу по сроку тарифа, не по продлению; при отметке урока потеряет поле",
  "cohort.chat":
    "v2 при сохранении курса в админке сотрёт чат потока; новых ссылок в чат не выдаст",
  "app_settings course_invg_*":
    "v2 не знает о чатах потоков: никого оттуда не исключит по окончании срока",
  "app_settings course_cur_*":
    "v2 не знает о кураторах: проверки ДЗ уйдут как раньше, без закрепления",
  "app_settings course_cert_no": "v2 не выдаёт сертификаты; счётчик номеров он не трогает",
  "order_events access_extended": "в истории заказа v2 покажет голое название события",
  "order_events cohort_moved": "в истории заказа v2 покажет голое название события",
} as const;

describe("данные школы v3, которых не знает v2", () => {
  it("run.until сохраняется v3 и удлиняет срок тарифа", () => {
    const until = "2026-12-31T23:59:59.999Z";
    const run = parseRun(JSON.stringify({ startedAt: "2026-10-01T00:00:00Z", done: [], until }));
    expect(run?.until).toBe(until);
    // Тариф на 30 дней, куплен 1 октября: по тарифу доступ кончился бы 31-го,
    // с продлением открыт и в ноябре; v2 этого поля не знает и закрыл бы его.
    const course = {
      ...parseCourse(null),
      tariffs: { v1: { accessDays: 30 } },
    } as never;
    const at = new Date("2026-11-10T00:00:00Z");
    const base = { course, boughtAt: "2026-10-01T00:00:00Z", variantId: "v1" };
    const plain = courseTimeline(
      { ...base, run: { startedAt: "2026-10-01T00:00:00Z" } },
      "UTC",
      at,
    );
    const extended = courseTimeline(
      { ...base, run: { startedAt: "2026-10-01T00:00:00Z", until } },
      "UTC",
      at,
    );
    expect(plain.expired).toBe(true);
    expect(extended.expired).toBe(false);
  });

  it("cohort.chat проходит разбор курса", () => {
    const course = parseCourse(
      JSON.stringify({
        lessons: [],
        cohorts: [
          {
            id: "c1000000-0000-4000-8000-000000000001",
            title: "Окт",
            start: "2026-10-05T10:00",
            chat: "-1007770001",
          },
        ],
      }),
    );
    expect(course.cohorts?.[0]?.chat).toBe("-1007770001");
  });

  it("ключи записей v3 не пересекаются с ключами v2", () => {
    expect(CHAT_KEY_PREFIX).toBe("course_invg_");
    expect(CURATOR_KEY_PREFIX).toBe("course_cur_");
    expect(runKey("x")).toBe("course_run_x");
    expect(courseKey("p")).toMatch(/^course_/);
  });

  it("события access_extended и cohort_moved v3 рисует, у v2 они без подписи", () => {
    const ext = describeOrderEvent({
      kind: "access_extended",
      actor: "system",
      payload: { until: "2027-01-31", reason: "болела" },
    } as never);
    expect(ext.text).toContain("продлён до 2027-01-31");
    const moved = describeOrderEvent({
      kind: "cohort_moved",
      actor: "system",
      payload: { from: "Окт", to: "Ноя" },
    } as never);
    expect(moved.text).toContain("Ноя");
  });

  it("реестр называет последствие каждого поля", () => {
    for (const [field, effect] of Object.entries(V3_ONLY)) {
      expect(field.length, field).toBeGreaterThan(3);
      expect(effect.length, field).toBeGreaterThan(20);
    }
  });
});
