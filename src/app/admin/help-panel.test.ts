import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SETTINGS_REGISTRY, settingsHelp } from "@/app/admin/settings/registry";
import { articleAnchors, helpArticle } from "@/core/help/articles";

/** «?» в админке: у карточек настроек и у переключателей — живые статьи и подзаголовки. */
describe("«?» ведут в «Помощь»", () => {
  it("каждая карточка «Оплата и настройки» описана: «?» в её углу ведёт на подзаголовок", () => {
    // Раздел-ссылка на другую страницу (`to`) «?» не рисует: там свой «?» у заголовка.
    for (const e of SETTINGS_REGISTRY.filter((x) => !x.to)) {
      const { article, anchor } = settingsHelp(e);
      const a = helpArticle(article, "ru");
      expect(a, `нет статьи ${article}`).toBeTruthy();
      expect(articleAnchors(a!.body), `${article}: нет {#${anchor}}`).toContain(anchor);
    }
  });

  it("каждый «?» в коде ведёт на существующую статью и подзаголовок", () => {
    const files = readdirSync("src", { recursive: true, encoding: "utf8" }).filter((f) =>
      f.endsWith(".tsx"),
    );
    let tips = 0;
    for (const f of files) {
      const text = readFileSync(`src/${f}`, "utf8");
      for (const m of text.matchAll(
        /<HelpTip\s+article="([a-z0-9-]+)"(?:\s+anchor="([a-z0-9-]+)")?/g,
      )) {
        tips++;
        const a = helpArticle(m[1]!, "ru");
        expect(a, `${f}: нет статьи ${m[1]}`).toBeTruthy();
        if (m[2]) expect(articleAnchors(a!.body), `${f}: нет {#${m[2]}} в ${m[1]}`).toContain(m[2]);
      }
    }
    expect(tips).toBeGreaterThan(20);
  });
});
