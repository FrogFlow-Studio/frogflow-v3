import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES as LOCALES } from "@/core/i18n/locale";
import {
  overdueTicketText,
  ticketAppendedText,
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

describe("дополнение к обращению из Mini App — продавцу на его языке", () => {
  it("на всех четырёх языках: номер, покупатель, текст и подсказка", () => {
    const c = { who: "Аня", text: "Добавлю: заказ №5" };
    const seen = new Set<string>();
    for (const l of LOCALES) {
      const t = ticketAppendedText(l, 7, c);
      expect(t).toContain("7");
      expect(t).toContain("Аня");
      expect(t).toContain("Добавлю: заказ №5");
      seen.add(t.split("\n")[0]!);
    }
    expect(seen.size).toBe(4);
    expect(ticketAppendedText("ru", 7, c)).toContain("Дополнение к обращению #7");
    expect(ticketAppendedText("en", 7, c)).toContain("Addition to request #7");
  });
});
