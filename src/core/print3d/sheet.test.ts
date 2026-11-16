import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import {
  clientCard,
  clientRef,
  clientRefOf,
  findOrderByPhone,
  findOrderInText,
  isReadyStatus,
  normOrderNo,
  parseOrders,
  photoUrl,
  PRINT3D_STAFF,
  PRINT3D_TEXTS,
  groupCardBound,
  waitingCandidate,
} from "./sheet";

const CSV = [
  "Номер,Имя,Телефон,Заказ,Срок,Сумма,Фото,Статус",
  "1234,Иван,+7 701 111 22 33,Кронштейн PETG,20.11,8000,https://drive.google.com/file/d/AbCdEfGhIjKlMn/view?usp=sharing,в работе",
  ",Пустая,,,,,,",
  "1235,Мария,87012223344,Корпус для платы,21.11,12000,,Готово",
].join("\n");

describe("таблица студии 3D-печати", () => {
  it("читает колонки по названиям и пропускает строки без номера", () => {
    const r = parseOrders(CSV);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.orders.map((o) => o.no)).toEqual(["1234", "1235"]);
    expect(r.orders[0]).toMatchObject({ name: "Иван", item: "Кронштейн PETG", row: 2 });
    expect(r.orders[1]!.row).toBe(4);
  });

  it("английские названия колонок тоже подходят; без номера или заказа — понятный отказ", () => {
    const en = parseOrders("Order,Name,Item,Status\nA-7,Ann,Gear,ready");
    expect(en.ok && en.orders[0]!.no).toBe("A-7");
    expect(parseOrders("Имя,Телефон\nИван,1")).toEqual({
      ok: false,
      reason: "noColumns",
      missing: ["no", "item"],
    });
  });

  it("«номер телефона» не путается с номером заказа", () => {
    const r = parseOrders("Номер телефона,Номер,Заказ\n+77011112233,55,Шестерня");
    expect(r.ok && r.orders[0]).toMatchObject({ no: "55", phone: "+77011112233" });
  });

  it("номер заказа находится в тексте клиента, цифры телефона и суммы — нет", () => {
    const r = parseOrders(CSV);
    if (!r.ok) throw new Error();
    expect(findOrderInText("1234", r.orders)?.no).toBe("1234");
    expect(findOrderInText("Здравствуйте, заказ №1235", r.orders)?.no).toBe("1235");
    expect(findOrderInText("мой телефон 87011112233, сумма 8000", r.orders)).toBeNull();
    expect(normOrderNo(" № 12 34 ")).toBe("1234");
  });

  it("телефон клиента: +7, 8 и без кода — один номер", () => {
    const r = parseOrders(CSV);
    if (!r.ok) throw new Error();
    expect(findOrderByPhone("+77012223344", r.orders)?.no).toBe("1235");
    expect(findOrderByPhone("7011112233", r.orders)?.no).toBe("1234");
    expect(findOrderByPhone("123", r.orders)).toBeNull();
  });

  it("статус «готово»: да для «Готово», «готов к выдаче», «ready»; нет для «не готово» и пусто", () => {
    for (const s of ["Готово", "готов к выдаче", "Ready", "дайын", "tayyor"])
      expect(isReadyStatus(s), s).toBe(true);
    for (const s of ["", "в работе", "не готово", "not ready", "Выдан", "готовится", "Готовим"])
      expect(isReadyStatus(s), s).toBe(false);
  });

  it("фото: ссылка Диска «Поделиться» → прямая; не https — нет фото", () => {
    expect(photoUrl("https://drive.google.com/file/d/AbCdEfGhIjKlMn/view?usp=sharing")).toBe(
      "https://drive.google.com/uc?export=download&id=AbCdEfGhIjKlMn",
    );
    expect(photoUrl("https://drive.google.com/open?id=AbCdEfGhIjKlMn")).toBe(
      "https://drive.google.com/uc?export=download&id=AbCdEfGhIjKlMn",
    );
    expect(photoUrl("http://example.com/a.jpg")).toBeNull();
    expect(photoUrl("фото у мастера")).toBeNull();
  });

  it("метка клиента для ответа свайпом читается обратно", () => {
    expect(clientRefOf(`…свайпом ${clientRef("777000111")}`)).toBe("777000111");
    expect(clientRefOf("без метки")).toBeNull();
  });

  it("карточка клиенту на всех 4 языках, без телефона и имени из таблицы", () => {
    const r = parseOrders(CSV);
    if (!r.ok) throw new Error();
    for (const loc of SUPPORTED_LOCALES) {
      const card = clientCard(r.orders[0]!, loc);
      expect(card, loc).toContain("1234");
      expect(card, loc).toContain("Кронштейн PETG");
      expect(card, loc).not.toContain("701 111");
      expect(card, loc).not.toContain("Иван");
      expect(PRINT3D_TEXTS[loc].askNumber.length, loc).toBeGreaterThan(10);
    }
  });
});

describe("номер, которого ещё нет в таблице", () => {
  it("только номер — да; вопрос, телефон, слово — нет", () => {
    expect(waitingCandidate("1240")).toBe("1240");
    expect(waitingCandidate("№ 1240")).toBe("1240");
    expect(waitingCandidate("заказ 1240")).toBe("1240");
    expect(waitingCandidate("A-17")).toBe("A-17");
    expect(waitingCandidate("87011112233")).toBeNull();
    expect(waitingCandidate("Здравствуйте")).toBeNull();
    expect(waitingCandidate("сколько стоит 2 детали")).toBeNull();
  });
});

describe("тексты рабочей группе — на языке админки продавца", () => {
  it("4 языка, метка клиента для свайпа везде", () => {
    const r = parseOrders(CSV);
    if (!r.ok) throw new Error();
    for (const loc of SUPPORTED_LOCALES) {
      const card = groupCardBound(r.orders[0]!, { id: "555", name: "" }, loc);
      expect(card, loc).toContain("#p3d555");
      expect(card, loc).toContain(PRINT3D_STAFF[loc].client);
      expect(PRINT3D_STAFF[loc].relaySent.length, loc).toBeGreaterThan(3);
    }
  });
});
