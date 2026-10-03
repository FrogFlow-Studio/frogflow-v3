import { describe, expect, it } from "vitest";
import { sellerSubscription } from "./seller-status";
import { DEFAULT_POLICY, type OverduePolicy } from "./subscription";
import { subscriptionLine } from "@/app/admin/subscription-banner";
import { adminT } from "@/app/i18n/admin";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";

const suspend: OverduePolicy = { on_overdue: "suspend", warn_days_before: 5, grace_days: 5 };
const warn: OverduePolicy = { ...DEFAULT_POLICY, on_overdue: "warn", warn_days_before: 5 };
const at = (iso: string) => new Date(`${iso}T09:00:00Z`);

describe("подписка глазами продавца", () => {
  it("нет срока — нечего показывать", () => {
    expect(sellerSubscription(null, suspend, false)).toBeNull();
  });

  it("оплачено заранее: дата и состояние ok", () => {
    const s = sellerSubscription("2026-11-15T00:00:00Z", suspend, false, at("2026-10-20"))!;
    expect(s).toMatchObject({ state: "ok", paidUntil: "2026-11-15", daysLeft: 26, stopOn: null });
  });

  it("просрочено при политике «приостановить»: день остановки — после отсрочки, как у обхода", () => {
    const s = sellerSubscription("2026-11-15T00:00:00Z", suspend, false, at("2026-11-17"))!;
    expect(s).toMatchObject({ state: "overdue", daysLeft: -2, stopOn: "2026-11-21" });
    // Сутки отсрочки кончились (5 дн.): обход приостановит на 6-й день.
    expect(
      sellerSubscription("2026-11-15T00:00:00Z", suspend, false, at("2026-11-20"))!.state,
    ).toBe("overdue");
    expect(
      sellerSubscription("2026-11-15T00:00:00Z", suspend, false, at("2026-11-21"))!.state,
    ).toBe("grace_over");
  });

  it("при политике «напоминать» остановки нет, у приостановленного — тоже", () => {
    expect(
      sellerSubscription("2026-11-15T00:00:00Z", warn, false, at("2026-11-17"))!.stopOn,
    ).toBeNull();
    const s = sellerSubscription("2026-11-15T00:00:00Z", suspend, true, at("2026-11-25"))!;
    expect(s.stopOn).toBeNull();
    expect(s.suspended).toBe(true);
  });

  it("фразы на всех четырёх языках без пропущенных подстановок", () => {
    const cases = [
      sellerSubscription("2026-11-15T00:00:00Z", suspend, false, at("2026-10-20"))!,
      sellerSubscription("2026-11-15T00:00:00Z", suspend, false, at("2026-11-12"))!,
      sellerSubscription("2026-11-15T00:00:00Z", suspend, false, at("2026-11-15"))!,
      sellerSubscription("2026-11-15T00:00:00Z", suspend, false, at("2026-11-17"))!,
      sellerSubscription("2026-11-15T00:00:00Z", suspend, false, at("2026-11-22"))!,
      sellerSubscription("2026-11-15T00:00:00Z", warn, false, at("2026-11-17"))!,
      sellerSubscription("2026-11-15T00:00:00Z", suspend, true, at("2026-11-25"))!,
    ];
    for (const locale of SUPPORTED_LOCALES) {
      const t = adminT(locale);
      for (const c of cases) {
        const line = subscriptionLine(t, locale, c);
        expect(line, `${locale} ${c.state}`).not.toMatch(/\{|undefined|NaN/);
        expect(line.length).toBeGreaterThan(10);
      }
    }
    const ru = adminT("ru");
    expect(subscriptionLine(ru, "ru", cases[3]!)).toContain("21.11");
    expect(subscriptionLine(ru, "ru", cases[3]!)).toContain("2 дн.");
  });
});
