import { describe, expect, it } from "vitest";
import {
  FAIL_THRESHOLD,
  FAIL_WINDOW_MS,
  detectProblems,
  downText,
  isDown,
  operatorHint,
  planGuard,
  planTransitions,
  registerFailure,
  upText,
} from "./guard";

const T0 = Date.parse("2026-10-04T09:05:00Z"); // 14:05 по Алматы
const iso = (ms: number) => new Date(ms).toISOString();

describe("страж каналов: что не так", () => {
  it("слетевший токен — Instagram лежит, WhatsApp нет", () => {
    const p = detectProblems(
      [
        { id: "a", platform: "instagram", expired: true },
        { id: "b", platform: "whatsapp" },
      ],
      true,
    );
    expect(p).toEqual({ instagram: "token" });
  });

  it("вебхук отключён — лежат оба канала, где есть аккаунт; токен приоритетнее", () => {
    const accounts = [
      { id: "a", platform: "instagram", expired: true },
      { id: "b", platform: "whatsapp" },
    ];
    expect(detectProblems(accounts, false)).toEqual({ instagram: "token", whatsapp: "webhook" });
  });

  it("вебхук не удалось проверить (null) — повода будить продавца нет; без аккаунтов канала нет", () => {
    expect(detectProblems([{ id: "b", platform: "whatsapp" }], null)).toEqual({});
    expect(detectProblems([], false)).toEqual({});
  });
});

describe("страж каналов: переходы", () => {
  it("лежит впервые — одно «упал» с временем начала", () => {
    const t = planTransitions({}, { instagram: "token" }, T0);
    expect(t).toEqual([
      {
        platform: "instagram",
        kind: "down",
        from: null,
        to: { since: iso(T0), reason: "token" },
      },
    ]);
  });

  it("лежит с той же причиной — переходов нет", () => {
    const cur = { instagram: { since: iso(T0), reason: "token" as const } };
    expect(planTransitions(cur, { instagram: "token" }, T0 + 60_000)).toEqual([]);
  });

  it("причина сменилась, пока лежит, — тихая запись без нового сообщения, время начала прежнее", () => {
    const cur = { instagram: { since: iso(T0), reason: "webhook" as const } };
    const [t] = planTransitions(cur, { instagram: "token" }, T0 + 60_000);
    expect(t).toMatchObject({ kind: "quiet", to: { since: iso(T0), reason: "token" } });
  });

  it("ожил — одно «снова работает», запись убирается", () => {
    const cur = { whatsapp: { since: iso(T0), reason: "token" as const } };
    expect(planTransitions(cur, {}, T0 + 3_600_000)).toEqual([
      { platform: "whatsapp", kind: "up", from: cur.whatsapp, to: null },
    ]);
  });
});

describe("страж каналов: серия сбоев отправки", () => {
  it("первые сбои — «на подозрении», канал ещё не лежит; на пороге — лежит один раз", () => {
    let cur = null as ReturnType<typeof registerFailure> extends infer R
      ? R extends { next: infer N }
        ? N | null
        : never
      : never;
    const downs: boolean[] = [];
    for (let i = 0; i < FAIL_THRESHOLD + 2; i++) {
      const r = registerFailure(cur, T0 + i * 60_000)!;
      downs.push(r.becameDown);
      expect(isDown(r.next)).toBe(i + 1 >= FAIL_THRESHOLD);
      cur = r.next;
    }
    expect(downs.filter(Boolean)).toHaveLength(1);
    expect(downs.indexOf(true)).toBe(FAIL_THRESHOLD - 1);
  });

  it("сбои с большими промежутками не копятся: счёт начинается заново", () => {
    const a = registerFailure(null, T0)!;
    const b = registerFailure(a.next, T0 + FAIL_WINDOW_MS + 1)!;
    expect(b.next.fails).toBe(1);
    expect(b.next.since).toBe(iso(T0 + FAIL_WINDOW_MS + 1));
  });

  it("если канал уже лежит по токену, сбои ничего не меняют", () => {
    expect(registerFailure({ since: iso(T0), reason: "token" }, T0 + 1000)).toBeNull();
  });

  it("серия закончилась: лежавший канал ожил («снова работает»), подозрительный — тихо", () => {
    const down = { since: iso(T0), reason: "failures" as const, fails: 3, last_fail_at: iso(T0) };
    const suspect = { ...down, fails: 1 };
    expect(planTransitions({ whatsapp: down }, {}, T0 + 10 * 60_000)).toEqual([]);
    expect(planTransitions({ whatsapp: down }, {}, T0 + FAIL_WINDOW_MS + 1)[0]).toMatchObject({
      kind: "up",
    });
    expect(planTransitions({ whatsapp: suspect }, {}, T0 + FAIL_WINDOW_MS + 1)[0]).toMatchObject({
      kind: "quiet",
    });
  });
});

describe("страж каналов: тексты", () => {
  const e = { since: iso(T0), reason: "token" as const };
  it("время в часовом поясе магазина на всех четырёх языках", () => {
    expect(downText("ru", "instagram", e, "Asia/Almaty")).toContain("Instagram отвалился с 14:05");
    expect(downText("kk", "instagram", e, "Asia/Almaty")).toContain("14:05");
    expect(downText("en", "whatsapp", e, "Asia/Almaty")).toContain(
      "WhatsApp has been down since 14:05",
    );
    expect(downText("uz", "whatsapp", e, "Asia/Almaty")).toContain("14:05");
  });
  it("«снова работает» на всех языках", () => {
    for (const l of ["ru", "kk", "en", "uz"] as const)
      expect(upText(l, "instagram")).toContain("Instagram");
    expect(upText("ru", "instagram")).toContain("снова работает");
  });
  it("подсказка оператору называет час и причину", () => {
    expect(operatorHint(e, "Asia/Almaty")).toBe("не отвечает с 14:05 (токен слетел)");
  });
});

describe("чтение арендатора: запись стража доходит до настроек", () => {
  it("settingsFromJson не теряет zernio.guard (иначе оператор не увидит упавший канал)", async () => {
    const { settingsFromJson } = await import("@/core/tenant/directory");
    const s = settingsFromJson({
      zernio: {
        profile_id: "p",
        guard: {
          instagram: { since: iso(T0), reason: "token" },
          whatsapp: { since: iso(T0), reason: "failures", fails: 3, last_fail_at: iso(T0) },
          telegram: { since: iso(T0), reason: "token" },
        },
      },
    });
    expect(s.zernio?.guard).toEqual({
      instagram: { since: iso(T0), reason: "token" },
      whatsapp: { since: iso(T0), reason: "failures", fails: 3, last_fail_at: iso(T0) },
    });
    expect(isDown(s.zernio?.guard?.whatsapp)).toBe(true);
    expect(
      settingsFromJson({ zernio: { guard: { instagram: { reason: "x" } } } }).zernio?.guard,
    ).toBeUndefined();
    expect(settingsFromJson({ zernio: {} }).zernio?.guard).toBeUndefined();
  });
});

describe("страж каналов: «неизвестно» не становится «ожил» (Л4)", () => {
  const ig = [{ id: "a", platform: "instagram" }];
  const down = (reason: "webhook" | "token") => ({
    instagram: { since: iso(T0 - 3_600_000), reason },
  });

  it("вебхук не проверен (null): запись «вебхук отключён» остаётся, сообщения «снова работает» нет", () => {
    expect(planGuard(down("webhook"), ig, null, T0)).toEqual([]);
    // Проверили и он в порядке — тогда «ожил».
    expect(planGuard(down("webhook"), ig, true, T0).map((t) => t.kind)).toEqual(["up"]);
    // Проверили и он всё ещё отключён — записи не меняются.
    expect(planGuard(down("webhook"), ig, false, T0)).toEqual([]);
  });

  it("токен: аккаунт больше не просрочен — «ожил» и при непроверенном вебхуке", () => {
    expect(planGuard(down("token"), ig, null, T0).map((t) => t.kind)).toEqual(["up"]);
  });

  it("канал отключён продавцом (аккаунтов нет): запись снимается молча, «снова работает» не шлётся", () => {
    const t = planGuard(down("token"), [], true, T0);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ platform: "instagram", kind: "quiet", to: null });
    expect(planGuard(down("webhook"), [], null, T0).map((x) => x.kind)).toEqual(["quiet"]);
  });

  it("серия сбоев отключённого канала тоже снимается молча", () => {
    const failing = {
      instagram: {
        since: iso(T0 - 3_600_000),
        reason: "failures" as const,
        fails: 3,
        last_fail_at: iso(T0 - FAIL_WINDOW_MS - 1),
      },
    };
    expect(planGuard(failing, [], true, T0).map((x) => x.kind)).toEqual(["quiet"]);
  });

  it("всё в порядке и записей нет — переходов нет", () => {
    expect(planGuard({}, ig, true, T0)).toEqual([]);
    expect(planGuard({}, [], null, T0)).toEqual([]);
  });
});
