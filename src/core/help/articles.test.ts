import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import {
  articleAnchors,
  HELP_ARTICLES,
  HELP_GROUPS,
  helpArticle,
  helpForPath,
  helpGroup,
  helpSlugs,
  parseBody,
  parseArticle,
  parseInline,
  searchHelp,
  suggestHelp,
} from "./articles";

/** База знаний «Помощь»: статьи — файлы docs/help; здесь полнота языков, живые ссылки и поиск. */
const links = (body: string) => [...body.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]!).sort();

describe("статьи: полнота", () => {
  it("статьи есть, три обязательные темы на месте", () => {
    expect(helpSlugs()).toEqual(
      expect.arrayContaining(["instagram-connect", "accept-payment", "bot-silent"]),
    );
  });

  it("у каждой статьи есть все четыре языка, заголовок, ключевые слова и тело", () => {
    for (const slug of helpSlugs()) {
      for (const l of SUPPORTED_LOCALES) {
        const a = HELP_ARTICLES.find((x) => x.slug === slug && x.locale === l);
        expect(a, `${slug}: нет перевода на ${l}`).toBeTruthy();
        expect(a!.title.length, `${slug}.${l}: заголовок`).toBeGreaterThan(3);
        expect(a!.keywords.length, `${slug}.${l}: ключевые слова`).toBeGreaterThanOrEqual(3);
        expect(a!.body.length, `${slug}.${l}: тело`).toBeGreaterThan(100);
      }
    }
  });

  it("переводы совпадают по устройству: те же ссылки и столько же шагов", () => {
    for (const slug of helpSlugs()) {
      const ru = helpArticle(slug, "ru")!;
      for (const l of SUPPORTED_LOCALES) {
        const a = helpArticle(slug, l)!;
        expect(links(a.body), `${slug}.${l}: ссылки`).toEqual(links(ru.body));
        const steps = (b: string) => b.split("\n").filter((x) => /^\d+\.\s/.test(x)).length;
        expect(steps(a.body), `${slug}.${l}: шаги`).toBe(steps(ru.body));
        expect(articleAnchors(a.body), `${slug}.${l}: якоря`).toEqual(articleAnchors(ru.body));
        expect([a.group, a.order], `${slug}.${l}: пункт меню и порядок`).toEqual([
          ru.group,
          ru.order,
        ]);
      }
    }
  });
});

describe("меню «Помощь»", () => {
  it("в каждом пункте есть статьи, якоря в статье не повторяются", () => {
    for (const g of HELP_GROUPS) expect(helpGroup(g, "ru").length, g).toBeGreaterThan(0);
    for (const a of HELP_ARTICLES) {
      const ids = articleAnchors(a.body);
      expect(new Set(ids).size, `${a.slug}.${a.locale}: повтор якоря`).toBe(ids.length);
    }
  });

  it("«?» у заголовка: адрес страницы → её статья, вложенный адрес — статья раздела", () => {
    expect(helpForPath("/admin/instagram", "ru")?.slug).toBe("instagram");
    expect(helpForPath("/admin/orders/123", "kk")?.slug).toBe("orders");
    expect(helpForPath("/admin/nope", "ru")).toBeNull();
  });

  it("одну страницу не объявляют две статьи", () => {
    const seen = new Map<string, string>();
    for (const a of HELP_ARTICLES.filter((x) => x.locale === "ru"))
      for (const p of a.pages) {
        expect(seen.get(p), `${p}: ${seen.get(p)} и ${a.slug}`).toBeUndefined();
        seen.set(p, a.slug);
      }
  });
});

describe("статьи: ссылки живые", () => {
  const tree = readFileSync("src/routeTree.gen.ts", "utf8");
  it("каждая ссылка ведёт на страницу, которая есть в маршрутах", () => {
    for (const a of HELP_ARTICLES)
      for (const href of links(a.body)) {
        const path = href.split(/[?#]/)[0]!;
        expect(tree.includes(`'${path}'`), `${a.slug}.${a.locale}: нет страницы ${path}`).toBe(
          true,
        );
      }
  });
});

describe("поиск", () => {
  it("находит по синониму, которого нет в заголовке", () => {
    expect(searchHelp("инста", "ru")[0]?.slug).toBe("instagram-connect");
    expect(searchHelp("каспи", "ru")[0]?.slug).toBe("accept-payment");
    expect(searchHelp("бот молчит", "ru")[0]?.slug).toBe("bot-silent");
    expect(searchHelp("ватсап", "kk")[0]?.slug).toBe("instagram-connect");
    expect(searchHelp("requisites", "en")[0]?.slug).toBe("accept-payment");
    expect(searchHelp("receipt", "en").map((a) => a.slug)).toContain("accept-payment");
    expect(searchHelp("vebxuk", "uz")[0]?.slug).toBe("bot-silent");
  });

  it("берёт основу слова: «подключение» находит «подключить»", () => {
    expect(searchHelp("подключение аккаунта", "ru").map((a) => a.slug)).toContain(
      "instagram-connect",
    );
  });

  it("пустой запрос — все статьи, чужой запрос — ничего", () => {
    expect(searchHelp("", "ru")).toHaveLength(helpSlugs().length);
    expect(searchHelp("зюзябра", "ru")).toEqual([]);
  });

  it("«возможно, вам поможет»: уверенное совпадение, случайное — нет", () => {
    expect(suggestHelp("бот не отвечает на сообщения покупателей", "ru")[0]?.slug).toBe(
      "bot-silent",
    );
    expect(suggestHelp("как принять оплату по чеку", "ru")[0]?.slug).toBe("accept-payment");
    expect(suggestHelp("спасибо большое", "ru")).toEqual([]);
    expect(suggestHelp("", "ru")).toEqual([]);
  });
});

describe("разметка", () => {
  it("подзаголовок с якорем и маркированный список", () => {
    const blocks = parseBody("Вступление.\n## Два шага {#two-step}\nТекст.\n\n- раз\n- два");
    expect(blocks.map((b) => b.type)).toEqual(["p", "h", "p", "ul"]);
    expect(blocks[1]).toEqual({ type: "h", text: "Два шага", id: "two-step" });
    expect(articleAnchors("## А {#a}\n\n## Б\n\n## В {#v}")).toEqual(["a", "v"]);
  });

  it("сведения статьи: пункт меню, порядок, страницы", () => {
    const a = parseArticle(
      "x",
      "ru",
      "# Заголовок\n\nkeywords: а, б, в\ngroup: guide\norder: 20\npages: /admin/orders, /admin/x\n\nТело.",
    );
    expect([a.group, a.order, a.pages, a.body]).toEqual([
      "guide",
      20,
      ["/admin/orders", "/admin/x"],
      "Тело.",
    ]);
  });

  it("абзац, нумерованный список и внутренние ссылки", () => {
    expect(parseInline("см. [настройки](/admin/settings) и [сайт](https://x.y)")).toEqual([
      { text: "см. " },
      { text: "настройки", href: "/admin/settings" },
      { text: " и [сайт](https://x.y)" },
    ]);
    const blocks = parseBody("Вступление.\n\n1. Раз\n2. Два [тут](/admin/chat)\n\nИтог.");
    expect(blocks.map((b) => b.type)).toEqual(["p", "ol", "p"]);
    expect(blocks[1]).toMatchObject({ type: "ol" });
  });
});
