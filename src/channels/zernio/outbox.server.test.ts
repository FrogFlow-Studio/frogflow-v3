import { describe, expect, it } from "vitest";
import { parseNotifyTemplate } from "./outbox.server";
import { buttonsComponent } from "./templates.server";

describe("WhatsApp: шаблон уведомлений и кнопки шаблона", () => {
  it("разбирает «имя:язык» и пустое значение", () => {
    expect(parseNotifyTemplate("order_update:ru")).toEqual({
      name: "order_update",
      language: "ru",
    });
    expect(parseNotifyTemplate(" order_update ")).toEqual({
      name: "order_update",
      language: undefined,
    });
    expect(parseNotifyTemplate("")).toBeNull();
  });
  it("кнопки уходят в Meta компонентом BUTTONS, не больше трёх, пустые отбрасываются", () => {
    expect(buttonsComponent([])).toBeNull();
    expect(
      buttonsComponent([
        { type: "QUICK_REPLY", text: " Да " },
        { type: "URL", text: "Сайт", url: "https://shop.kz/" },
        { type: "PHONE_NUMBER", text: "Позвонить", phone: "+7 (701) 123-45-67" },
        { type: "QUICK_REPLY", text: "лишняя" },
        { type: "QUICK_REPLY", text: "" },
      ]),
    ).toEqual({
      type: "BUTTONS",
      buttons: [
        { type: "QUICK_REPLY", text: "Да" },
        { type: "URL", text: "Сайт", url: "https://shop.kz/" },
        { type: "PHONE_NUMBER", text: "Позвонить", phone_number: "+77011234567" },
      ],
    });
  });
});
