import { describe, expect, it } from "vitest";
import { parseZernioMessage } from "./message";
import { customerImageUrls } from "./handle-message";

/**
 * Фото покупателя для консультанта по прайсу (v1 incomingImageUrls): снимок —
 * модели, а публикация (её товары приходят отметкой) и гифка-реакция — нет.
 */
const base = {
  event: "message.received",
  account: { platform: "instagram", accountId: "acc1" },
  conversation: { id: "conv1" },
};

describe("фото покупателя в директе", () => {
  it("снимок — модели; гифка из стикеров — нет; не больше трёх", () => {
    const m = parseZernioMessage({
      ...base,
      message: {
        id: "m1",
        text: "",
        sender: { id: "u1" },
        attachments: [
          { type: "image", url: "https://cdn.example/photo1.jpg" },
          { type: "image", url: "https://media.giphy.com/media/x/giphy.gif" },
          { type: "image", url: "https://cdn.example/photo2.jpg" },
          { type: "image", url: "https://cdn.example/photo3.jpg" },
          { type: "image", url: "https://cdn.example/photo4.jpg" },
        ],
      },
    } as never);
    expect(customerImageUrls(m)).toEqual([
      "https://cdn.example/photo1.jpg",
      "https://cdn.example/photo2.jpg",
      "https://cdn.example/photo3.jpg",
    ]);
  });

  it("ответ на сторис — не фото покупателя", () => {
    const m = parseZernioMessage({
      ...base,
      message: {
        id: "m2",
        text: "Сколько стоит?",
        sender: { id: "u1" },
        attachments: [{ type: "story_mention", url: "https://cdn.example/story.jpg" }],
      },
    } as never);
    expect(customerImageUrls(m)).toEqual([]);
  });
});
