import { beforeEach, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { ConsultantProduct } from "./catalog";
import {
  decidePricelistReply,
  phoneIn,
  type PricelistData,
  type PricelistState,
} from "./engine.server";
import { toTurn } from "./turn.server";
import { withModelCategories, writesRubles } from "./finalize";
import { priceRub } from "./rate";
import type { ProductMedia } from "./media";
import type { ConsultantKnowledgeArticle } from "./knowledge";
import type { V2Image } from "./images";

/**
 * Консультант по прайсу (перенос tests/consultant-v2-engine.test.ts v1): решает
 * модель, код даёт данные и защищает. Ответ модели подменяется — проверяется,
 * что уходит в модель и что делается с её ответом и вызовами инструментов.
 */

const catalog: ConsultantProduct[] = [
  {
    id: "T1",
    name: "Uchino полотенце банное",
    category: "Полотенца",
    size: "50x100",
    colors: ["белый", "серый"],
    price_kzt: 9000,
    stock: true,
  },
];

type Sent = {
  system: { text: string }[];
  tools: { name: string }[];
  messages: { role: string; content: unknown }[];
  tool_choice?: unknown;
};
let requests: Sent[] = [];
let responses: (Anthropic.ContentBlock[] | "late")[] = [];
const knowledgeArticles: ConsultantKnowledgeArticle[] = [];
const media: ProductMedia[] = [
  { id: "m1", match: "Uchino полотенце", path: "bot/t1.jpg", kind: "image", createdAt: "" },
];

function reply(content: unknown[]): Anthropic.ContentBlock[] {
  return content as Anthropic.ContentBlock[];
}

beforeEach(() => {
  requests = [];
  responses = [];
  knowledgeArticles.length = 0;
});

// Днём по Алматы (11:00): ночью к сообщению добавляется пометка о нерабочих часах.
const DAY = new Date("2026-09-25T06:00:00Z");

type Opts = {
  catalog?: ConsultantProduct[];
  now?: Date;
  images?: V2Image[];
  storyProductIds?: string[];
  storyMediaUrl?: string;
  fetchImage?: (url: string) => Promise<V2Image | null>;
  onToolCall?: (name: string) => void;
};

function dataOf(o: Opts): PricelistData {
  return {
    catalog: o.catalog ?? catalog,
    synonyms: [],
    shopUrl: "https://bovi.kz",
    store: { address: "Сатпаева, 3", phone: "+7 777", hours: "10–22" },
    articles: knowledgeArticles,
    rate: { rate: 4.2, updatedAt: DAY.toISOString(), source: "test" },
    hours: { open: 10, close: 21 },
    timezone: "Asia/Almaty",
    storyTags: [],
    loadMedia: async () => media,
    mediaUrl: (path) => `https://test.app/api/img/bot/${path}`,
  };
}

async function decide(text: string, state: PricelistState = {}, o: Opts = {}) {
  const d = await decidePricelistReply(dataOf(o), {
    text,
    state,
    now: o.now ?? DAY,
    images: o.images,
    storyProductIds: o.storyProductIds,
    story: o.storyMediaUrl ? { storyId: null, mediaUrl: o.storyMediaUrl } : undefined,
    fetchImage: o.fetchImage ?? (async () => null),
    onToolCall: o.onToolCall,
    call: async (req) => {
      requests.push(JSON.parse(JSON.stringify(req)) as Sent);
      const next = responses.shift();
      if (next === "late" || next === undefined) return "late";
      return { content: next, stop_reason: "end_turn" } as unknown as Anthropic.Message;
    },
  });
  return { d, turn: toTurn(d, text) };
}

const lastMessage = (i: number) => JSON.stringify(requests[i]!.messages.at(-1));

describe("консультант по прайсу", () => {
  it("обычный ответ: короткий промпт, прайс в нём, свои инструменты вместо ask_manager", async () => {
    responses.push(reply([{ type: "text", text: "50х100 — 9 000 ₸. Какой цвет?" }]));
    const { turn } = await decide("Есть полотенца для рук?");
    expect(turn.reply).toBe("50х100 - 9 000 ₸. Какой цвет?");
    expect(turn.handoff).toBeNull();
    const sent = requests[0]!;
    expect(sent.system[0]!.text).toContain("КТО ВЫ");
    // Вместо прайса — карта ассортимента: раздел, марка, размеры, цена «от».
    expect(sent.system[0]!.text).toContain("КАРТА АССОРТИМЕНТА");
    expect(sent.system[0]!.text).toMatch(
      /Полотенца — полотенце \(Uchino\): 1 поз\.; размеры 50x100; от 9\s000 ₸/,
    );
    expect(sent.system[0]!.text).not.toContain("Uchino полотенце банное");
    const names = sent.tools.map((t) => t.name);
    expect(names).toContain("handoff_to_manager");
    expect(names).toContain("remember_customer");
    expect(names).not.toContain("ask_manager");
    expect(lastMessage(0)).toContain("Есть полотенца для рук?");
  });

  it("remember_customer: сказанное покупателем запоминается и приходит пометкой в следующий раз", async () => {
    responses.push(
      reply([
        {
          type: "tool_use",
          id: "t1",
          name: "remember_customer",
          input: { looking_for: "полотенца", for_whom: "подарок маме", budget: "до 50 тысяч" },
        },
      ]),
      reply([{ type: "text", text: "Для подарка есть Uchino 50х100 — 9 000 ₸. Какой цвет?" }]),
    );
    const { turn } = await decide("Ищу полотенца маме в подарок, до 50 тысяч");
    expect(turn.patch.profile).toEqual({
      looking_for: "полотенца",
      for_whom: "подарок маме",
      budget: "до 50 тысяч",
    });
    expect(requests).toHaveLength(2);

    responses.push(reply([{ type: "text", text: "Белый есть." }]));
    await decide("А белый?", { profile: turn.patch.profile });
    expect(lastMessage(2)).toContain("Что известно о покупателе");
    expect(lastMessage(2)).toContain("подарок маме");
  });

  it("память о покупателе из диалога, начатого в v1, читается (v2_profile)", async () => {
    responses.push(reply([{ type: "text", text: "Белый есть." }]));
    await decide("А белый?", { v2_profile: { for_whom: "подарок маме" } });
    expect(lastMessage(0)).toContain("подарок маме");
  });

  it("передачу менеджеру решает модель: причина и суть уходят в задачу, фраза — покупателю", async () => {
    responses.push(
      reply([
        { type: "text", text: "Подключаю менеджера, она оформит заказ!" },
        {
          type: "tool_use",
          id: "t1",
          name: "handoff_to_manager",
          input: { reason: "purchase", summary: "Uchino 50х100 белый, 2 шт" },
        },
      ]),
    );
    // Телефон и город уже спрашивали — передача сразу.
    const { d, turn } = await decide("Беру два белых", { contact_asked: true });
    expect(requests).toHaveLength(1);
    expect(d.handoff?.reason).toBe("purchase");
    expect(turn.reply).toBe("Подключаю менеджера, она оформит заказ.");
    expect(turn.handoff).toMatchObject({
      kind: "lead",
      reason: "purchase",
      summary: "Uchino 50х100 белый, 2 шт",
    });
  });

  it("карточка менеджеру: суть и что известно о покупателе", async () => {
    responses.push(
      reply([
        { type: "text", text: "Передаю менеджеру, она оформит заказ." },
        {
          type: "tool_use",
          id: "t1",
          name: "handoff_to_manager",
          input: { reason: "purchase", summary: "Uchino 50х100 белый, 2 шт" },
        },
      ]),
    );
    const profile = {
      looking_for: "полотенца",
      for_whom: "подарок маме",
      size: "50х100",
      country: "Россия",
      city: "Москва",
      delivery: "СДЭК",
      phone: "+7 916 000 00 00",
    };
    const { turn } = await decide("Беру два", { profile });
    const note = turn.handoff!.summary;
    expect(note).toContain("Uchino 50х100 белый, 2 шт");
    expect(note).toContain(
      "О покупателе: полотенца; подарок маме; размер 50х100; Москва, Россия; СДЭК",
    );
    // Телефон — в контакты задачи, не в строку «О покупателе».
    expect(turn.handoff!.customerContact).toBe("+7 916 000 00 00");
  });

  it("рубли считает код: модель пишет тенге, покупатель видит рубли по формуле", async () => {
    responses.push(reply([{ type: "text", text: "Uchino 50х100 — 9 000 ₸." }]));
    const { turn } = await decide("Сколько в рублях?");
    expect(turn.reply).toBe(`Uchino 50х100 - ${priceRub(9000, 4.2).toLocaleString("ru-RU")} ₽.`);
    expect(turn.patch.rub).toBe(true);
    // В карте ассортимента рублей нет — путать нечего.
    const line = requests[0]!.system[0]!.text.split("\n").find((l) => l.startsWith("• Полотенца"));
    expect(line).toMatch(/9\s000 ₸/);
    expect(line).not.toContain("₽");
  });

  it("модель сама написала рубли — ответ переспрашивается в тенге, рубли считает код", async () => {
    responses.push(
      reply([
        {
          type: "text",
          text: "Uchino 50х100 — примерно 2 016 ₽. Точный расчёт уточнит менеджер.",
        },
      ]),
      reply([{ type: "text", text: "Uchino 50х100 — 9 000 ₸." }]),
    );
    const { turn } = await decide("Сколько в рублях?");
    // Напоминание о рублях — в самом сообщении покупателя.
    expect(lastMessage(0)).toContain("Покупателю нужны рубли");
    expect(requests).toHaveLength(2);
    expect(lastMessage(1)).toContain("цены — в тенге");
    expect(turn.reply).toBe(`Uchino 50х100 - ${priceRub(9000, 4.2).toLocaleString("ru-RU")} ₽.`);
    expect(turn.tools).toContain("fix:rubles_by_model");
    // В историю — тенге: в них модель и продолжит разговор.
    expect(turn.historyReply).toBe("Uchino 50х100 - 9 000 ₸.");
  });

  it("рублей не просили — напоминания о них нет, история та же, что ушла покупателю", async () => {
    responses.push(reply([{ type: "text", text: "Uchino 50х100 — 9 000 ₸." }]));
    const { turn } = await decide("Есть полотенца?");
    expect(lastMessage(0)).not.toContain("рублях");
    expect(turn.historyReply).toBeUndefined();
  });

  it("выбор рублей из диалога, начатого в v1, сохраняется (v2_rub)", async () => {
    responses.push(reply([{ type: "text", text: "Uchino 50х100 — 9 000 ₸." }]));
    const { turn } = await decide("Белое сколько?", { v2_rub: true });
    expect(turn.reply).toContain("₽");
  });

  it("черновик с чужой ценой не уходит: модель переписывает один раз по пометке", async () => {
    const pillows: ConsultantProduct[] = [
      {
        id: "S1",
        name: "Traumina подушка из функц. волокна Swing light 50х70",
        category: "Подушки",
        size: "50х70",
        colors: [],
        price_kzt: 55000,
        stock: true,
      },
      {
        id: "S2",
        name: "Traumina подушка из функц. волокна Swing Extra Light 50х70",
        category: "Подушки",
        size: "50х70",
        colors: [],
        price_kzt: 50000,
        stock: true,
      },
      ...Array.from({ length: 30 }, (_, i) => ({
        id: `N${i}`,
        name: `BOVI КПБ модель ${i}`,
        category: "КПБ",
        size: "200x220",
        colors: [],
        price_kzt: 300000 + i,
        stock: true,
      })),
    ];
    responses.push(
      reply([
        { type: "text", text: "Traumina Swing Light 50х70 - 50 000 ₸. Какой цвет? И размер?" },
      ]),
      reply([{ type: "text", text: "Traumina Swing Light 50х70 - 55 000 ₸. Какой размер нужен?" }]),
    );
    const { turn } = await decide("помягче", {}, { catalog: pillows });
    expect(requests).toHaveLength(2);
    const note = lastMessage(1);
    expect(note).toContain("Цена не той позиции");
    expect(note).toMatch(/55\s000/);
    expect(note).toContain("больше одного вопроса");
    expect(turn.reply).toBe("Traumina Swing Light 50х70 - 55 000 ₸. Какой размер нужен?");
    expect(turn.tools).toContain("fix:draft:price+questions");
  });

  it("обещал менеджера, но не позвал — модель переписывает и зовёт", async () => {
    responses.push(
      reply([{ type: "text", text: "Передаю менеджеру, она оформит заказ." }]),
      reply([
        { type: "text", text: "Передаю менеджеру, она оформит заказ." },
        {
          type: "tool_use",
          id: "t1",
          name: "handoff_to_manager",
          input: { reason: "purchase", summary: "Uchino 50х100" },
        },
      ]),
    );
    const { turn } = await decide("Беру", { contact_asked: true });
    expect(requests).toHaveLength(2);
    expect(lastMessage(1)).toContain("не вызвали handoff_to_manager");
    expect(turn.handoff?.reason).toBe("purchase");
  });

  it("заказ без телефона: сначала телефон и как забрать — как у v1, менеджеру пока не передаём", async () => {
    responses.push(
      reply([
        { type: "text", text: "Передаю менеджеру, она оформит заказ." },
        {
          type: "tool_use",
          id: "t1",
          name: "handoff_to_manager",
          input: { reason: "purchase", summary: "Uchino 50х100 белый" },
        },
      ]),
      reply([
        {
          type: "text",
          text: "Хорошо. Напишите, пожалуйста, телефон и город доставки — или заберёте в бутике?",
        },
      ]),
    );
    const { turn } = await decide("Беру белое");
    expect(turn.handoff).toBeNull();
    expect(lastMessage(1)).toContain("Заказ ещё не передан");
    expect(turn.reply).toContain("телефон");
    expect(turn.patch).toMatchObject({ contact_asked: true });
    expect(turn.tools).toContain("ask_contact");
  });

  it("телефон в сообщении — передача сразу, номер в контакты задачи", async () => {
    responses.push(
      reply([
        { type: "text", text: "Спасибо, передаю менеджеру — она оформит заказ." },
        {
          type: "tool_use",
          id: "t1",
          name: "handoff_to_manager",
          input: { reason: "purchase", summary: "Traumina Swing 50х70" },
        },
      ]),
    );
    const { turn } = await decide("Оформляем. Мой номер +7 700 253 88 88, Алматы");
    expect(turn.handoff?.reason).toBe("purchase");
    expect(turn.handoff?.customerContact).toBe("+7 700 253 88 88");
    expect(turn.patch.contact_asked).toBeUndefined();
  });

  it("ночью — пометка: менеджер ответит утром; днём её нет", async () => {
    responses.push(reply([{ type: "text", text: "Здравствуйте. Что подсказать?" }]));
    await decide("Здравствуйте", {}, { now: new Date("2026-09-25T18:30:00Z") });
    expect(lastMessage(0)).toContain("Менеджер ответит утром");
    responses.push(reply([{ type: "text", text: "Здравствуйте. Что подсказать?" }]));
    await decide("Здравствуйте");
    expect(lastMessage(1)).not.toContain("Менеджер ответит утром");
  });

  it("телефон в тексте: номер, а не размер или цена", () => {
    expect(phoneIn("Мой номер +7 700 253 88 88, Алматы")).toBe("+7 700 253 88 88");
    expect(phoneIn("87002538888 Алмата")).toBe("87002538888");
    expect(phoneIn("8 (916) 123-45-67")).toBe("8 (916) 123-45-67");
    expect(phoneIn("Беру 70х140 за 55 000")).toBeUndefined();
    expect(phoneIn("КПБ 200x220 и 240x220")).toBeUndefined();
  });

  it("ходы кончились на поиске — ещё запрос без инструментов, покупателю не уходит «Поищу иначе:»", async () => {
    const search = (id: string) =>
      reply([
        { type: "text", text: "Поищу иначе:" },
        { type: "tool_use", id, name: "search_products", input: { query: "семейный" } },
      ]);
    responses.push(search("s1"), search("s2"), search("s3"), search("s4"));
    responses.push(
      reply([{ type: "text", text: "Семейных комплектов сейчас нет. Показать полотенца Uchino?" }]),
    );
    const { turn } = await decide("Цену семейного комплекта?");
    expect(requests).toHaveLength(5);
    expect(requests[4]!.tool_choice).toEqual({ type: "none" });
    expect(turn.reply).toBe("Семейных комплектов сейчас нет. Показать полотенца Uchino?");
    expect(turn.tools).toContain("fix:final_without_tools");
  });

  it("семейный комплект — поиск отдаёт комплекты с двумя пододеяльниками", async () => {
    const family = {
      id: "F1",
      name: "BOVI КПБ BRISE (2 подод 155x200, 2 наволочки 50x75), цвет зеленый",
      category: "Постельное белье BOVI",
      size: "155x200",
      colors: ["зеленый"],
      price_kzt: 220000,
      stock: true,
    };
    responses.push(
      reply([
        {
          type: "tool_use",
          id: "s1",
          name: "search_products",
          input: { query: "семейный комплект" },
        },
      ]),
      reply([
        { type: "text", text: "Семейный BRISE с двумя пододеяльниками 155х200 — 220 000 ₸." },
      ]),
    );
    const { turn } = await decide(
      "Цену семейного комплекта?",
      {},
      { catalog: [...catalog, family] },
    );
    expect(lastMessage(1)).toContain("BRISE");
    expect(turn.tools).toContain("fix:family_sets");
  });

  it("«Понял,» в начале ответа снимается", async () => {
    responses.push(
      reply([{ type: "text", text: "Понял, подушка для сна. Какой размер: 40х60 или 50х70?" }]),
    );
    const { turn } = await decide("Для снв");
    expect(turn.reply).toBe("Подушка для сна. Какой размер: 40х60 или 50х70?");
  });

  it("одно фото на всю модель: второй размер — already_sent, а не «нет фото» и менеджер (BOVI 25.09)", async () => {
    const t2 = { ...catalog[0]!, id: "T2", size: "70x140" };
    responses.push(
      reply([
        { type: "tool_use", id: "p1", name: "send_product_photo", input: { product_id: "T1" } },
        { type: "tool_use", id: "p2", name: "send_product_photo", input: { product_id: "T2" } },
      ]),
      reply([{ type: "text", text: "Вот фото — оно для обоих размеров." }]),
    );
    const { turn } = await decide("Фото есть?", {}, { catalog: [...catalog, t2] });
    expect(turn.attachments).toHaveLength(1);
    expect(lastMessage(1)).toContain("already_sent");
    expect(turn.handoff).toBeNull();
    expect(turn.patch).toMatchObject({ media_sent: ["bot/t1.jpg"] });
  });

  it("фото уже было в диалоге — второй раз не шлём; просят видео — фото не подсовываем", async () => {
    responses.push(
      reply([
        { type: "tool_use", id: "p1", name: "send_product_photo", input: { product_id: "T1" } },
      ]),
      reply([{ type: "text", text: "Фото выше в переписке." }]),
    );
    // Путь из диалога, начатого в v1 (v2_media_sent), тоже считается.
    const again = await decide("Фото есть?", { v2_media_sent: ["bot/t1.jpg"] });
    expect(again.turn.attachments).toEqual([]);
    expect(lastMessage(1)).toContain("already_sent");

    requests = [];
    responses.push(
      reply([
        {
          type: "tool_use",
          id: "v1",
          name: "send_product_photo",
          input: { product_id: "T1", kind: "video" },
        },
      ]),
      reply([{ type: "text", text: "Видео пришлёт менеджер." }]),
    );
    const video = await decide("Видео нет?");
    expect(video.turn.attachments).toEqual([]);
    expect(lastMessage(1)).toContain('\\"found\\":false');
  });

  it("фото и передача в одном ходе — фото всё равно уходит покупателю", async () => {
    responses.push(
      reply([
        { type: "text", text: "Вот фото. Остальное пришлёт менеджер." },
        { type: "tool_use", id: "p1", name: "send_product_photo", input: { product_id: "T1" } },
        {
          type: "tool_use",
          id: "h1",
          name: "handoff_to_manager",
          input: { reason: "photo", summary: "Нужно видео" },
        },
      ]),
    );
    const { turn } = await decide("Фото и видео пришлите");
    expect(turn.handoff?.reason).toBe("photo");
    expect(turn.attachments).toHaveLength(1);
  });

  it("чистый черновик уходит без переписывания", async () => {
    responses.push(reply([{ type: "text", text: "Uchino 50х100 — 9 000 ₸. Какой цвет?" }]));
    await decide("Есть полотенца?");
    expect(requests).toHaveLength(1);
  });

  it("фото покупателя — модели картинкой рядом с текстом", async () => {
    responses.push(
      reply([{ type: "text", text: "Похоже на махровое полотенце. Uchino 50х100 — 9 000 ₸." }]),
    );
    const jpeg = { mediaType: "image/jpeg" as const, data: "/9j/4AAQ" };
    const { turn } = await decide("", {}, { images: [jpeg] });
    const last = requests[0]!.messages.at(-1) as { content: { type: string; text?: string }[] };
    expect(last.content[0]!.type).toBe("image");
    expect(last.content.at(-1)?.text).toContain("Покупатель прислал фото — оно ниже");
    expect(turn.tools).toContain("photo:1");
  });

  it("сторис без отметки — модель видит картинку публикации", async () => {
    responses.push(
      reply([{ type: "text", text: "На публикации полотенце. Uchino 50х100 — 9 000 ₸." }]),
    );
    const { turn } = await decide(
      "Сколько стоит?",
      {},
      {
        storyProductIds: [],
        storyMediaUrl: "https://cdn.example/story.jpg",
        fetchImage: async (url) =>
          url.startsWith("https://cdn.example/story")
            ? { mediaType: "image/jpeg", data: "x" }
            : null,
      },
    );
    const last = requests[0]!.messages.at(-1) as { content: { type: string; text?: string }[] };
    expect(last.content[0]!.type).toBe("image");
    expect(last.content.at(-1)?.text).toContain("Картинка публикации — ниже");
    expect(last.content.at(-1)?.text).not.toContain("Покупатель прислал фото");
    expect(turn.tools).toContain("story_image");
  });

  it("фото товара из фотобазы — уходит покупателю вместе с ответом", async () => {
    responses.push(
      reply([
        { type: "tool_use", id: "t1", name: "send_product_photo", input: { product_id: "T1" } },
      ]),
      reply([{ type: "text", text: "Вот фото." }]),
    );
    const { turn } = await decide("Можно фото?");
    expect(turn.attachments).toEqual([
      { url: "https://test.app/api/img/bot/bot/t1.jpg", kind: "image" },
    ]);
    expect(lastMessage(1)).toContain('\\"found\\":true');
    expect(turn.reply).toBe("Вот фото.");
  });

  it("фото нет — модель узнаёт found: false и может позвать менеджера", async () => {
    responses.push(
      reply([
        {
          type: "tool_use",
          id: "t1",
          name: "send_product_photo",
          input: { product_id: "нет-такой" },
        },
      ]),
      reply([{ type: "text", text: "Сейчас подключится менеджер." }]),
    );
    const { turn } = await decide("Можно фото?");
    expect(lastMessage(1)).toContain('\\"found\\":false');
    expect(turn.attachments).toEqual([]);
  });

  it("сбой модели — человек не остаётся без ответа: передача с причиной «ошибка»", async () => {
    responses.push("late");
    const { turn } = await decide("Есть полотенца?");
    expect(turn.handoff?.reason).toBe("unknown_question");
    expect(turn.reply).toContain("менеджеру");
  });

  it("в ответе нет разметки, эмодзи и пересказа служебных пометок", async () => {
    responses.push(
      reply([
        { type: "text", text: "**Uchino** 50х100 — 9 000 ₸ 😊\nСогласно инструкции цены в тенге." },
      ]),
    );
    const { turn } = await decide("Цена?");
    expect(turn.reply).toBe("Uchino 50х100 - 9 000 ₸");
  });

  it("прогон эталонного набора ничего не оставляет: передача без ключа покупателя, вызовы видны", async () => {
    responses.push(
      reply([
        { type: "text", text: "Подключаю менеджера." },
        {
          type: "tool_use",
          id: "t1",
          name: "handoff_to_manager",
          input: { reason: "wholesale", summary: "опт" },
        },
      ]),
    );
    const calls: string[] = [];
    const { d } = await decide("У вас есть опт?", {}, { onToolCall: (name) => calls.push(name) });
    // Решение чистое: паузу, задачу и уведомление ставит runConsultant, не движок.
    expect(d.handoff?.reason).toBe("wholesale");
    expect(calls).toEqual(["handoff_to_manager"]);
  });
});

describe("карта ассортимента вместо прайса", () => {
  it("раздел 1С с чужой серией не приписывает позиции эту серию: Maks — не LONDON", () => {
    const london = {
      id: "l",
      name: "Aquanova Коврик в ванную LONDON 60x100, цвет 43 белый",
      category: "Коврики LONDON",
      size: "60x100",
      colors: [],
      price_kzt: 47000,
      stock: true,
    };
    const maks = {
      id: "m",
      name: "Aquanova Коврик в ванную Maks 60х60, цвет 10 слон.кость",
      category: "Коврики LONDON",
      size: "60х60",
      colors: [],
      price_kzt: 58000,
      stock: true,
    };
    expect(withModelCategories({ products: [london, maks], returned: 2 })).toMatchObject({
      products: [{ category: "Коврики LONDON" }, { category: "Коврики" }],
      returned: 2,
    });
    expect(withModelCategories(maks)).toMatchObject({ category: "Коврики" });
    expect(withModelCategories({ error: "not_found" })).toEqual({ error: "not_found" });
  });
});

describe("статья базы знаний о моделях — к вопросу покупателя", () => {
  it("«Акванова Макс и Лондон в чем разница?» — статья приходит пометкой, в журнале kb_models", async () => {
    knowledgeArticles.push({
      id: "aq",
      title: "Aquanova Collection Overview",
      tags: [],
      content: "London: 100% египетский хлопок (1200 г/м²). Силиконовые точки против скольжения.",
      updatedAt: "",
    });
    responses.push(
      reply([
        { type: "text", text: "London — египетский хлопок, 1200 г/м². О Maks в базе данных нет." },
      ]),
    );
    // Марки и модели — редкие слова прайса: в каталоге из трёх строк редких нет.
    const filler = Array.from({ length: 8 }, (_, i) => ({
      ...catalog[0]!,
      id: `f${i}`,
      name: `Простыня хлопковая ${i}`,
    }));
    const catalogWithMats = [
      ...catalog,
      ...filler,
      {
        id: "l",
        name: "Aquanova Коврик в ванную LONDON 60x100, цвет 43 белый",
        category: "Коврики LONDON",
        size: "60x100",
        colors: [],
        price_kzt: 47000,
        stock: true,
      },
      {
        id: "m",
        name: "Aquanova Коврик в ванную Maks 60х60, цвет 10 слон.кость",
        category: "Коврики LONDON",
        size: "60х60",
        colors: [],
        price_kzt: 58000,
        stock: true,
      },
    ];
    const { turn } = await decide(
      "Акванова Макс и Лондон в чем разница?",
      {},
      { catalog: catalogWithMats },
    );
    expect(lastMessage(0)).toContain("египетский хлопок");
    expect(turn.tools).toContain("kb_models");
  });
});

describe("рубли в ответе модели", () => {
  it("находит суммы в рублях, но не слово «рубли» и не «рубашки»", () => {
    expect(writesRubles("Air Waffle - 8 960 ₽")).toBe(true);
    expect(writesRubles("8960 руб.")).toBe(true);
    expect(writesRubles("9 000 рублей")).toBe(true);
    expect(writesRubles("Показать цены в рублях?")).toBe(false);
    expect(writesRubles("2 рубашки к пижаме")).toBe(false);
    expect(writesRubles("40 000 ₸")).toBe(false);
  });
});

describe("живой диалог BOVI 27.09: клиентка из Москвы, наматрасник", () => {
  it("«доставка в Москву» — страна и город в профиль, цены дальше в рублях", async () => {
    responses.push(
      reply([{ type: "text", text: "Доставка в Россию - через СДЭК, по тарифам СДЭК." }]),
    );
    const first = await decide("Подскажите стоимость доставки в Москву? И сроки.");
    expect(first.turn.patch.profile).toMatchObject({ country: "Россия", city: "Москва" });
    expect(first.turn.patch.rub).toBe(true);
    responses.push(reply([{ type: "text", text: "Uchino 50х100 — 9 000 ₸." }]));
    const second = await decide("Полотенца сколько стоят?", {
      profile: first.turn.patch.profile,
      rub: first.turn.patch.rub,
    });
    expect(second.turn.reply).toBe(
      `Uchino 50х100 - ${priceRub(9000, 4.2).toLocaleString("ru-RU")} ₽.`,
    );
    expect(lastMessage(1)).toContain("город: Москва");
  });

  it("тенге «по умолчанию» не запоминается: страна, названная позже, включает рубли", async () => {
    responses.push(reply([{ type: "text", text: "Есть Uchino 50х100. Какой цвет?" }]));
    const first = await decide("Полотенца есть?");
    expect(first.turn.patch.rub).toBeUndefined();
    responses.push(reply([{ type: "text", text: "Uchino 50х100 — 9 000 ₸." }]));
    const second = await decide("Белое сколько?", { profile: { country: "Россия" } });
    expect(second.turn.reply).toContain("₽");
  });

  it("черновик с выдуманным свойством: модель переписывает, покупатель видит новый", async () => {
    responses.push(
      reply([{ type: "text", text: "Uchino 50х100 быстро сохнет, непромокаемое, 9 000 ₸." }]),
      reply([
        {
          type: "text",
          text: "Uchino 50х100 - 9 000 ₸. Про непромокаемость в описании не указано.",
        },
      ]),
    );
    const { turn } = await decide("Полотенце непромокаемое есть?");
    expect(turn.tools).toContain("fix:draft:property");
    expect(lastMessage(1)).toContain("непромокаемое");
    expect(turn.reply).toContain("в описании не указано");
  });
});
