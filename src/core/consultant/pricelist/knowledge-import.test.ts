import { describe, expect, it } from "vitest";
import {
  articlesFromText,
  KNOWLEDGE_ARTICLE_MAX_CHARS,
  mergeKnowledge,
  previewMerge,
} from "./knowledge-import";
import type { ConsultantKnowledgeArticle } from "./knowledge";

/** Загрузка статей в базу знаний: разбор для предпросмотра и слияние без потерь. */
const now = new Date("2026-10-07T10:00:00Z");
const art = (id: string, title: string, content = "текст"): ConsultantKnowledgeArticle => ({
  id,
  title,
  tags: ["старый"],
  content,
  updatedAt: "2026-09-01T00:00:00.000Z",
});

describe("статьи из текста", () => {
  it("разделители ### и ---, теги строкой и в скобках, переводы строк Windows", () => {
    const { articles, truncated } = articlesFromText(
      "### Уход [уход, стирка]\r\nСтирать при 40°C.\r\n---\r\nДоставка\r\nТеги: доставка, алматы\r\nПо Алматы — бесплатно.",
    );
    expect(truncated).toBe(0);
    expect(articles).toEqual([
      { title: "Уход", tags: ["уход", "стирка"], content: "Стирать при 40°C." },
      { title: "Доставка", tags: ["доставка", "алматы"], content: "По Алматы — бесплатно." },
    ]);
  });

  it("файл без разделителей — одна статья с именем файла и всем текстом", () => {
    const text = "Dorelan — итальянская фабрика.\nМатрасы с латексом.";
    expect(articlesFromText(text, "Dorelan_Overview.pdf").articles).toEqual([
      { title: "Dorelan Overview", tags: [], content: text },
    ]);
    // Вставленный текст без разделителей: первая строка — заголовок, как в v1.
    expect(articlesFromText(text).articles[0]!.title).toBe("Dorelan — итальянская фабрика.");
  });

  it("длинная статья обрезается, и это видно в предпросмотре", () => {
    const { articles, truncated } = articlesFromText(
      "x".repeat(KNOWLEDGE_ARTICLE_MAX_CHARS + 5),
      "big.pdf",
    );
    expect(truncated).toBe(1);
    expect(articles[0]!.content).toHaveLength(KNOWLEDGE_ARTICLE_MAX_CHARS);
  });

  it("пустой текст — ни одной статьи", () => {
    expect(articlesFromText("  \n ").articles).toEqual([]);
  });
});

describe("слияние с базой", () => {
  it("прежние статьи остаются все и на своих местах, новые — в конец", () => {
    const existing = [art("a", "Уход"), art("b", "Фабрики")];
    const r = mergeKnowledge(
      existing,
      [{ title: "Доставка", tags: [], content: "бесплатно" }],
      now,
    );
    expect(r).toMatchObject({ added: 1, updated: 0 });
    expect(r.articles.map((a) => a.id).slice(0, 2)).toEqual(["a", "b"]);
    expect(r.articles[2]).toMatchObject({
      title: "Доставка",
      content: "бесплатно",
      updatedAt: now.toISOString(),
    });
    expect(r.articles[2]!.id).not.toBe("a");
  });

  it("тот же заголовок (без учёта регистра) обновляет статью: id прежний, теги обоих", () => {
    const r = mergeKnowledge(
      [art("a", "Уход за бельём")],
      [{ title: "  уход ЗА  бельём ", tags: ["новый"], content: "новый текст" }],
      now,
    );
    expect(r).toMatchObject({ added: 0, updated: 1 });
    expect(r.articles).toEqual([
      {
        id: "a",
        title: "Уход за бельём",
        tags: ["старый", "новый"],
        content: "новый текст",
        updatedAt: now.toISOString(),
      },
    ]);
  });

  it("повтор заголовка внутри загрузки не теряет вторую статью", () => {
    const r = mergeKnowledge(
      [art("a", "Уход")],
      [
        { title: "Уход", tags: [], content: "первая" },
        { title: "Уход", tags: [], content: "вторая" },
      ],
      now,
    );
    expect(r).toMatchObject({ added: 1, updated: 1 });
    expect(r.articles.map((a) => a.content)).toEqual(["первая", "вторая"]);
    expect(new Set(r.articles.map((a) => a.id)).size).toBe(2);
  });

  it("новые id не совпадают с уже занятыми", () => {
    const stamp = now.getTime().toString(36);
    const r = mergeKnowledge(
      [art(`kb-${stamp}-0`, "Старая")],
      [{ title: "Новая", tags: [], content: "т" }],
      now,
    );
    expect(r.articles[1]!.id).toBe(`kb-${stamp}-1`);
  });

  it("предпросмотр отмечает, какие статьи обновят существующие", () => {
    expect(
      previewMerge(
        [art("a", "Уход")],
        [
          { title: "уход", tags: [], content: "т" },
          { title: "Новая", tags: [], content: "т" },
        ],
      ).map((a) => a.replaces),
    ).toEqual([true, false]);
  });
});
