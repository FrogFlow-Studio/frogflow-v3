import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import { operatorAlertHtml, preview, sellerReplyText } from "./notice-text";

describe("тексты уведомлений поддержки", () => {
  it("начало сообщения: пробелы схлопнуты, длинное обрезано", () => {
    expect(preview("  привет \n\n  мир ")).toBe("привет мир");
    const long = preview("а".repeat(500));
    expect(long).toHaveLength(300);
    expect(long.endsWith("…")).toBe(true);
  });

  it("продавцу — на каждом из четырёх языков, с текстом и ссылкой", () => {
    const seen = new Set<string>();
    for (const l of SUPPORTED_LOCALES) {
      const t = sellerReplyText(l, "Проверьте токен", "https://app.test/admin/support");
      expect(t).toContain("Проверьте токен");
      expect(t).toContain("https://app.test/admin/support");
      seen.add(t.split("\n")[0]!);
    }
    expect(seen.size).toBe(4);
  });

  it("оператору — HTML экранирован: чужой текст не ломает разметку", () => {
    const h = operatorAlertHtml(
      "Лавка <b>",
      "<script>1 & 2</script>",
      "https://x/operator/support?bot=1",
    );
    expect(h).not.toContain("<script>");
    expect(h).toContain("&lt;script&gt;1 &amp; 2&lt;/script&gt;");
    expect(h).toContain("«Лавка &lt;b&gt;»");
  });
});
