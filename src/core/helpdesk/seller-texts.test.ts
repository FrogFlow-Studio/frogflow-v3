import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES as LOCALES } from "@/core/i18n/locale";
import {
  overdueTicketText,
  ticketNoticeText,
  unansweredChatText,
  waitedText,
} from "./seller-texts";

const card = {
  who: "👤 Аня",
  assignee: null,
  preview: "где заказ",
  link: "https://x/admin/chat?c=1",
};

describe("тексты продавцу об ожидании ответа", () => {
  it("на всех четырёх языках: срок, номер, ссылка и подпись ответственного", () => {
    const now = Date.parse("2026-09-27T12:00:00Z");
    for (const l of LOCALES) {
      const waited = waitedText(l, "2026-09-27T09:55:00Z", now);
      expect(waited).toMatch(/^2 \S+ 5 \S+$/);
      const chat = unansweredChatText(l, waited, card);
      const ticket = overdueTicketText(l, 42, waited, { ...card, assignee: "Мария" });
      expect(chat).toContain(waited);
      expect(chat).toContain(card.link);
      expect(ticket).toContain("42");
      expect(ticket).toContain("Мария");
      expect(chat).not.toContain("Мария");
    }
    expect(unansweredChatText("ru", "5 мин", card)).toContain("Ответственный не назначен");
    expect(unansweredChatText("en", "5 min", card)).toContain("No one assigned");
    expect(unansweredChatText("kk", "5 мин", card)).not.toContain("Покупатель");
    expect(overdueTicketText("uz", 7, "1 soat", card)).not.toContain("Обращение");
  });
});

describe("уведомление продавцу об обращении", () => {
  it("новое и дополнение на четырёх языках, с номером, автором и текстом", () => {
    for (const l of LOCALES) {
      const n = ticketNoticeText(l, true, 5, "👤 Аня", "где заказ");
      const a = ticketNoticeText(l, false, 5, "👤 Аня", "где заказ");
      for (const t of [n, a]) expect(t).toMatch(/#5|№5/);
      for (const t of [n, a]) expect(t).toContain("👤 Аня\n\nгде заказ\n\n");
      expect(n).not.toBe(a);
    }
    expect(ticketNoticeText("ru", false, 2, "x", "y")).toContain("Дополнение к обращению #2");
    expect(ticketNoticeText("en", true, 2, "x", "y")).toContain("New request #2");
  });
});
