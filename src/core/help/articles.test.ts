import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import {
  HELP_ARTICLES,
  helpArticle,
  helpSlugs,
  parseBody,
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
      }
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
    expect(searchHelp("receipt", "en")[0]?.slug).toBe("accept-payment");
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
