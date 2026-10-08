import { describe, expect, it } from "vitest";
import { DEFAULT_REPLY_PROMPT } from "@/core/instagram/comment-rules";
import {
  copyRuleFormValues,
  RULE_NAME_MAX,
  ruleFormDirty,
  ruleFormValues,
  type RuleSource,
} from "./instagram-rule-form";

const rule: RuleSource = {
  id: "rule-1",
  accountId: "acc-2",
  name: "Рилс про прописи",
  trigger: "comment",
  platformPostId: "ig-post-1",
  postId: "zernio-post-1",
  postTitle: "Прописи для первоклашек",
  keywords: ["хочу", "прописи"],
  matchMode: "exact",
  dmMessage: "Спасибо! Ответьте «+», и я пришлю ссылку",
  buttons: [
    { type: "postback", title: "Купить", payload: "PROD:42" },
    { type: "url", title: "Сайт", url: "https://example.com" },
  ],
  commentReply: "Отправили в Direct!",
  commentReplyVariations: ["Проверьте Direct 📩", "Ссылка в личке"],
  twoStepDm: true,
  secondDmMessage: "Вот каталог 👇",
  unresolvedPrompt: "Напишите, какой товар нужен",
  replyPrompt: "Ответьте «+»",
};

const copyName = (name: string) => `${name} (копия)`;

describe("«Скопировать правило» Instagram", () => {
  it("тексты, кнопки, варианты ответа и настройки скопированы, пост пуст, id нет", () => {
    const v = copyRuleFormValues(rule, copyName);
    expect(v).toEqual({
      accountId: "acc-2",
      name: "Рилс про прописи (копия)",
      trigger: "comment",
      target: null,
      keywords: "хочу, прописи",
      replyToAll: false,
      matchMode: "exact",
      dmMessage: "Спасибо! Ответьте «+», и я пришлю ссылку",
      buttons: [
        { type: "postback", title: "Купить", payload: "PROD:42" },
        { type: "url", title: "Сайт", url: "https://example.com" },
      ],
      commentReplies: ["Отправили в Direct!", "Проверьте Direct 📩", "Ссылка в личке"],
      twoStepDm: true,
      secondDmMessage: "Вот каталог 👇",
      unresolvedPrompt: "Напишите, какой товар нужен",
      replyPrompt: "Ответьте «+»",
    });
    expect(v).not.toHaveProperty("id");
    expect(JSON.stringify(v)).not.toContain("rule-1");
    expect(JSON.stringify(v)).not.toContain("ig-post-1");
    expect(JSON.stringify(v)).not.toContain("zernio-post-1");
  });

  it("кнопки — новые объекты: правка копии не меняет исходное правило", () => {
    const v = copyRuleFormValues(rule, copyName);
    v.buttons[0]!.title = "Изменено";
    expect(rule.buttons[0]!.title).toBe("Купить");
  });

  it("длинное название укорачивается, пометка копии остаётся", () => {
    const long = { ...rule, name: "я".repeat(RULE_NAME_MAX) };
    const v = copyRuleFormValues(long, copyName);
    expect(v.name.length).toBe(RULE_NAME_MAX);
    expect(v.name.endsWith(" (копия)")).toBe(true);
  });

  it("правило «ответ на все комментарии поста» копируется с тем же режимом", () => {
    const v = copyRuleFormValues({ ...rule, keywords: [] }, copyName);
    expect(v.replyToAll).toBe(true);
    expect(v.keywords).toBe("");
    expect(v.target).toBeNull();
  });

  it("без своего призыва ответить берётся призыв по умолчанию", () => {
    const v = copyRuleFormValues({ ...rule, replyPrompt: null }, copyName);
    expect(v.replyPrompt).toBe(DEFAULT_REPLY_PROMPT);
  });
});

describe("форма правила: начальные значения и несохранённые изменения", () => {
  it("новое правило — пустая форма на первом аккаунте", () => {
    const v = ruleFormValues(null, "acc-1");
    expect(v.accountId).toBe("acc-1");
    expect(v.name).toBe("");
    expect(v.target).toBeNull();
    expect(v.buttons).toEqual([]);
    expect(v.commentReplies).toEqual([""]);
  });

  it("«Изменить» сохраняет пост правила", () => {
    expect(ruleFormValues(rule, "acc-1").target).toEqual({
      platformPostId: "ig-post-1",
      postId: "zernio-post-1",
      title: "Прописи для первоклашек",
    });
  });

  it("нетронутая форма чистая, правка текста — несохранённое изменение", () => {
    const init = copyRuleFormValues(rule, copyName);
    expect(ruleFormDirty({ ...init, buttons: init.buttons.map((b) => ({ ...b })) }, init)).toBe(
      false,
    );
    expect(ruleFormDirty({ ...init, dmMessage: "другое" }, init)).toBe(true);
  });
});
