import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";

// Автопоиск: выдача DuckDuckGo и модель подставные, остальное — настоящий путь (разбор, сверка дублей, запись).
const db = fakeDb();
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
let apiKey: string | undefined = "sk-test";
vi.mock("@/config/env", () => ({ env: () => ({ ANTHROPIC_API_KEY: apiKey }) }));
let modelReply: string | Error = "[]";
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async () => {
        if (modelReply instanceof Error) throw modelReply;
        return { content: [{ type: "text", text: modelReply }] };
      },
    };
  },
}));

const { huntLeads } = await import("./hunt.server");

const PAGE = `<div class="result"><div class="links_main result__body">
<h2 class="result__title"><a class="result__a" href="https://sever.kz/">Север</a></h2>
<a class="result__snippet" href="x">кофе Астана</a></div></div>`;
const fetchMock = vi.fn();
const answer = (status: number, body = PAGE) => ({ status, text: async () => body });

const ai = (items: unknown[]) => JSON.stringify(items);
const sever = {
  businessName: "Кофейня Север",
  instagram: "sever",
  phone: "",
  email: "",
  website: "",
};
const dolce = {
  businessName: "Дольче",
  instagram: "",
  phone: "+7 705 000 11 22",
  email: "",
  website: "",
};

beforeEach(() => {
  apiKey = "sk-test";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  db.tables.sales_leads = [];
  db.tables.sales_lead_events = [];
});
afterEach(() => vi.unstubAllGlobals());

describe("huntLeads", () => {
  it("находит, отсекает дубли (с воронкой и между собой) и пишет новые лиды с источником hunt", async () => {
    db.tables.sales_leads = [
      { id: "old", business_name: "Старый", instagram_handle: "sever", stage: "new" },
    ];
    fetchMock.mockResolvedValue(answer(200));
    modelReply = ai([sever, dolce, { ...dolce, businessName: "Дольче копия" }]);
    const r = await huntLeads({ niche: "кофе", city: "Астана" }, "admin_a");
    expect(r).toMatchObject({ found: 3, added: 1, duplicates: 2, names: ["Дольче"], note: null });
    const added = db.tables.sales_leads!.filter((l) => l.id !== "old");
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      business_name: "Дольче",
      phone: "77050001122",
      niche: "кофе",
      city: "Астана",
      source: "hunt",
      stage: "new",
      created_by: "admin_a",
    });
    expect(db.tables.sales_lead_events).toMatchObject([
      { kind: "created", detail: "Найден автопоиском: кофе, Астана" },
    ]);
    // Два запроса, у каждого тайм-аут.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) expect(call[1].signal).toBeInstanceOf(AbortSignal);
  });

  it("DuckDuckGo просит проверку (202) — понятная заметка, модель не вызывается", async () => {
    fetchMock.mockResolvedValue(answer(202, "<html>captcha</html>"));
    modelReply = new Error("модель не должна вызываться");
    const r = await huntLeads({ niche: "кофе", city: "" }, "a");
    expect(r).toMatchObject({ found: 0, added: 0 });
    expect(r.note).toMatch(/недоступен/);
  });

  it("один запрос упал, второй сработал — поиск идёт по тому, что есть", async () => {
    fetchMock.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(answer(200));
    modelReply = ai([dolce]);
    expect(await huntLeads({ niche: "кофе", city: "" }, "a")).toMatchObject({ added: 1 });
  });

  it("сбой модели — serverFailure, лиды не пишутся; нет ключа — отказ без поиска", async () => {
    fetchMock.mockResolvedValue(answer(200));
    modelReply = new Error("overloaded");
    await expect(huntLeads({ niche: "кофе", city: "" }, "a")).rejects.toThrow(/автопоиск лидов/);
    expect(db.tables.sales_leads).toHaveLength(0);
    apiKey = undefined;
    fetchMock.mockClear();
    await expect(huntLeads({ niche: "кофе", city: "" }, "a")).rejects.toThrow(/ключ/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("всё найденное уже в воронке — заметка; пустая ниша — отказ без поиска", async () => {
    db.tables.sales_leads = [{ id: "o", business_name: "Север", instagram_handle: "sever" }];
    fetchMock.mockResolvedValue(answer(200));
    modelReply = ai([sever]);
    expect(await huntLeads({ niche: "кофе", city: "" }, "a")).toMatchObject({
      added: 0,
      duplicates: 1,
      note: "Все найденные уже есть в воронке.",
    });
    fetchMock.mockClear();
    expect((await huntLeads({ niche: "  ", city: "" }, "a")).note).toBe("Укажите нишу");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
