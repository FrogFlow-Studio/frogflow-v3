import { describe, expect, it } from "vitest";
import { buildHuntPrompt, mergeHits, parseHuntLeads, parseSearchHits, resolveHitUrl } from "./hunt";

const HTML = `
<div class="result results_links results_links_deep web-result">
 <div class="links_main links_deep result__body">
  <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.instagram.com%2Fsever.coffee%2F&amp;rut=abc">Кофейня <b>Север</b> (@sever.coffee)</a></h2>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=x">Кофе с собой &amp; десерты, заказ в Direct. Астана</a>
 </div>
</div>
<div class="result result--ad">
 <div class="links_main links_deep result__body">
  <h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fad.example%2F&amp;ad_provider=bing">Реклама</a></h2>
 </div>
</div>
<div class="result"><div class="links_main result__body">
  <h2 class="result__title"><a class="result__a" href="https://sever.kz/">Сайт Север</a></h2>
  <a class="result__snippet" href="https://sever.kz/">Телефон +7 705 111 22 33</a>
</div></div>`;

describe("parseSearchHits", () => {
  it("берёт заголовок, настоящий адрес и сниппет; рекламу отбрасывает", () => {
    expect(parseSearchHits(HTML)).toEqual([
      {
        url: "https://www.instagram.com/sever.coffee/",
        title: "Кофейня Север (@sever.coffee)",
        snippet: "Кофе с собой & десерты, заказ в Direct. Астана",
      },
      { url: "https://sever.kz/", title: "Сайт Север", snippet: "Телефон +7 705 111 22 33" },
    ]);
  });
  it("страница проверки без результатов — пусто; лимит работает", () => {
    expect(parseSearchHits("<html>Are you a human?</html>")).toEqual([]);
    expect(parseSearchHits(HTML, 1)).toHaveLength(1);
  });
});

describe("resolveHitUrl и mergeHits", () => {
  it("не-http и редирект без адреса — null", () => {
    expect(resolveHitUrl("javascript:alert(1)")).toBeNull();
    expect(resolveHitUrl("//duckduckgo.com/l/?rut=1")).toBeNull();
    expect(resolveHitUrl("//duckduckgo.com/l/?uddg=ftp%3A%2F%2Fx")).toBeNull();
  });
  it("один адрес из двух запросов — один раз", () => {
    const a = { url: "https://www.sever.kz/", title: "a", snippet: "" };
    const b = { url: "http://sever.kz", title: "b", snippet: "" };
    expect(mergeHits([[a], [b, { ...a, url: "https://other.kz/" }]])).toHaveLength(2);
  });
});

describe("parseHuntLeads", () => {
  it("нормализует контакты, подставляет нишу и город, отбрасывает без контакта", () => {
    const leads = parseHuntLeads(
      `Вот: [
        {"businessName":"Кофейня Север","instagram":"@Sever.Coffee","phone":"+7 705 111 22 33","email":"","website":"https://www.sever.kz/","signals":"кофе"},
        {"businessName":"Без контактов","instagram":"","phone":"","email":"","website":""},
        {"businessName":"","instagram":"x"},
        42
      ]`,
      { niche: "кофе", city: "Астана" },
    );
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      businessName: "Кофейня Север",
      instagramHandle: "sever.coffee",
      phone: "77051112233",
      websiteUrl: "sever.kz",
      niche: "кофе",
      city: "Астана",
    });
  });
  it("не JSON и не массив — пусто", () => {
    expect(parseHuntLeads("нет", { niche: "x", city: "" })).toEqual([]);
    expect(parseHuntLeads("[сломано]", { niche: "x", city: "" })).toEqual([]);
  });
  it("промпт запрещает выдумывать контакты и содержит выдачу", () => {
    const p = buildHuntPrompt("кофе", "Астана", [
      { url: "https://sever.kz/", title: "Север", snippet: "s" },
    ]);
    expect(p).toContain("ничего не придумывай");
    expect(p).toContain("https://sever.kz/");
  });
});
