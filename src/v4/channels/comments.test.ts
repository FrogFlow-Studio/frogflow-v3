import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SendOutcome } from "../core/cases/cases";
import { pgliteV4, v4Db } from "../test/pg";
import type { CardButton, InstagramChannel } from "./channel";
import { acceptComment, noteExternalDm, onDirectMessage, runCommentSends } from "./comments";

/**
 * Comment-to-DM v4 на настоящем Postgres (PGlite) и подставном канале.
 * Схема из прода (осознанные решения): ответ под комментарием + Direct;
 * первое сообщение без кнопок, после «+» — карточка с кнопкой; наш Direct
 * не раньше 60 с, если Zernio не ответил сам.
 */

const A = "aaaaaaaa-0000-4000-8000-0000000000e1";
const B = "bbbbbbbb-0000-4000-8000-0000000000e2";
const POST = "17890000000000001";
let pg: PGlite;
const svc = () => pgliteV4(pg);
const asA = () => pgliteV4(pg, { botId: A });
const asB = () => pgliteV4(pg, { botId: B });
let notebook: string;
let seq = 0;

type Sent = {
  kind: "public" | "dm" | "card";
  to: string;
  text: string;
  post?: string;
  buttons?: CardButton[];
};
function fakeChannel(outcome: SendOutcome | "throw" = "sent") {
  const sent: Sent[] = [];
  const go = async (s: Sent): Promise<SendOutcome> => {
    sent.push(s);
    if (outcome === "throw") throw new Error("ECONNRESET");
    return outcome;
  };
  const ch: InstagramChannel = {
    publicReply: (post, to, text) => go({ kind: "public", to, text, post }),
    privateReply: (post, to, text) => go({ kind: "dm", to, text, post }),
    sendCard: (to, text, buttons) => go({ kind: "card", to, text, buttons }),
  };
  return { ch, sent };
}

const T0 = new Date("2026-11-02T10:00:00Z");
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);
const comment = (text: string, extra: Partial<Parameters<typeof acceptComment>[1]> = {}) =>
  acceptComment(asA(), {
    botId: A,
    externalId: `c${++seq}`,
    postId: POST,
    commenterId: `u${seq}`,
    text,
    commentedAt: T0,
    now: T0,
    ...extra,
  });
const statusOf = async (id: string) =>
  (
    await pg.query<{ public_status: string; dm_status: string; card_status: string }>(
      "select public_status, dm_status, card_status from v4.comments where id = $1",
      [id],
    )
  ).rows[0]!;

beforeAll(async () => {
  pg = await v4Db();
  for (const bot of [A, B]) {
    await pg.query("insert into v4.shops (bot_id, base_currency) values ($1, 'KZT')", [bot]);
  }
  await pg.query("update v4.shops set spam_words = '{казино}' where bot_id = $1", [A]);
  notebook = (
    await pg.query<{ id: string }>(
      "insert into v4.products (bot_id, title, kind, base_price_minor) values ($1, 'Рабочая тетрадь', 'file', 450000) returning id",
      [A],
    )
  ).rows[0]!.id;
  // Правило поста: «хочу» → ответ под комментарием, Direct, карточка после «+».
  await pg.query(
    `insert into v4.comment_rules (bot_id, post_id, match_mode, keywords, public_reply, dm_first, product_id, card_text)
     values ($1, $2, 'contains', '{хочу,цена}', 'Написала вам в Direct 💌', 'Здравствуйте! Ответьте «+», и я пришлю тетрадь с кнопкой оплаты.', $3, 'Рабочая тетрадь — 4 500 ₸')`,
    [A, POST, notebook],
  );
  // Общее правило на все посты: точное слово, без карточки.
  await pg.query(
    `insert into v4.comment_rules (bot_id, match_mode, keywords, public_reply, dm_first)
     values ($1, 'exact', '{инфо}', 'Отправила в Direct', 'Вот информация о магазине.')`,
    [A],
  );
}, 60_000);
afterAll(async () => {
  await pg?.close();
});

describe("accept_comment", () => {
  it("повтор вебхука — та же строка, тот же покупатель", async () => {
    const c1 = await acceptComment(asA(), {
      botId: A,
      externalId: "dup-1",
      postId: POST,
      commenterId: "dup-user",
      text: "Хочу!",
      commentedAt: T0,
      now: T0,
    });
    const c2 = await acceptComment(asA(), {
      botId: A,
      externalId: "dup-1",
      postId: POST,
      commenterId: "dup-user",
      text: "Хочу!",
      commentedAt: T0,
      now: T0,
    });
    expect(c1.created).toBe(true);
    expect(c2).toEqual({ ...c1, created: false });
    expect(c1.verdict).toBe("rule");
  });

  it("тот же человек во втором комментарии — тот же покупатель", async () => {
    const base = { botId: A, postId: POST, commenterId: "same-u", commentedAt: T0, now: T0 };
    const a = await acceptComment(asA(), { ...base, externalId: "s1", text: "хочу" });
    const b = await acceptComment(asA(), { ...base, externalId: "s2", text: "цена?" });
    expect(b.buyerId).toBe(a.buyerId);
  });

  it("спам — ссылки и слова магазина, без ответа и без ИИ (решение 56)", async () => {
    expect((await comment("хочу, пиши t.me/xxx")).verdict).toBe("spam");
    expect((await comment("Казино Вулкан хочу")).verdict).toBe("spam");
    const ok = await comment("Хочу тетрадь");
    expect(ok.verdict).toBe("rule");
  });

  it("нет совпадения — без ответа; точное слово общего правила — на любом посте", async () => {
    const none = await comment("Красиво");
    expect(none.verdict).toBe("no_rule");
    expect(await statusOf(none.commentId)).toMatchObject({
      public_status: "none",
      dm_status: "none",
    });
    expect((await comment("Инфо", { postId: "other" })).verdict).toBe("rule");
    expect((await comment("инфо пожалуйста", { postId: "other" })).verdict).toBe("no_rule");
  });

  it("ответ в ветке — только публичный ответ: в Direct Instagram не пускает", async () => {
    const n = await comment("хочу", { nested: true });
    expect(n.verdict).toBe("nested");
    expect(await statusOf(n.commentId)).toMatchObject({
      public_status: "pending",
      dm_status: "none",
    });
  });

  it("второй магазин правил первого не видит", async () => {
    const c = await acceptComment(asB(), {
      botId: B,
      externalId: "b-1",
      postId: POST,
      commenterId: "bu",
      text: "хочу",
      commentedAt: T0,
      now: T0,
    });
    expect(c.verdict).toBe("no_rule");
  });
});

describe("отправщик: ответ под комментарием сразу, Direct через 60 с", () => {
  it("публичный ответ уходит сразу, Direct ждёт минуту; первое сообщение без кнопок", async () => {
    await pg.query(
      "update v4.comments set public_status = 'failed' where public_status = 'pending'",
    );
    await pg.query("update v4.comments set dm_status = 'expired' where dm_status = 'pending'");
    const c = await comment("Хочу!");
    const { ch, sent } = fakeChannel();
    await runCommentSends(svc(), () => ch, { now: () => at(5) });
    expect(sent).toEqual([
      { kind: "public", to: `c${seq}`, text: "Написала вам в Direct 💌", post: POST },
    ]);

    await runCommentSends(svc(), () => ch, { now: () => at(30) });
    expect(sent).toHaveLength(1);

    await runCommentSends(svc(), () => ch, { now: () => at(61) });
    expect(sent[1]).toMatchObject({ kind: "dm", to: `c${seq}` });
    expect(sent[1]!.buttons).toBeUndefined();
    expect(await statusOf(c.commentId)).toMatchObject({
      public_status: "sent",
      dm_status: "sent",
      card_status: "awaiting_plus",
    });

    // Следующий проход ничего не повторяет.
    await runCommentSends(svc(), () => ch, { now: () => at(120) });
    expect(sent).toHaveLength(2);
  });

  it("Zernio успел сам — наш Direct не уходит", async () => {
    const c = await comment("хочу");
    expect(await noteExternalDm(svc(), A, `c${seq}`)).toBe(true);
    const { ch, sent } = fakeChannel();
    await runCommentSends(svc(), () => ch, { now: () => at(90) });
    expect(sent.map((s) => s.kind)).toEqual(["public"]);
    expect((await statusOf(c.commentId)).dm_status).toBe("external");
  });

  it("обрыв при отправке — unknown, повтора нет (могло дойти)", async () => {
    const c = await comment("хочу");
    const { ch, sent } = fakeChannel("throw");
    await runCommentSends(svc(), () => ch, { now: () => at(90) });
    await runCommentSends(svc(), () => ch, { now: () => at(200) });
    expect(sent.map((s) => s.kind)).toEqual(["public", "dm"]);
    expect(await statusOf(c.commentId)).toMatchObject({
      public_status: "unknown",
      dm_status: "unknown",
    });
  });

  it("исполнитель упал посреди отправки — через 3 минуты unknown, не повтор", async () => {
    const c = await comment("хочу");
    await svc().call("claim_comment_sends", { p_limit: 50, p_now: at(1).toISOString() });
    expect((await statusOf(c.commentId)).public_status).toBe("sending");
    const { ch, sent } = fakeChannel();
    await runCommentSends(svc(), () => ch, { now: () => at(1 + 4 * 60) });
    expect((await statusOf(c.commentId)).public_status).toBe("unknown");
    expect(sent.filter((s) => s.to === `c${seq}` && s.kind === "public")).toHaveLength(0);
  });

  it("комментарию больше 6,5 суток — Direct не шлём", async () => {
    const old = new Date(T0.getTime() - 7 * 86_400_000);
    const c = await comment("хочу", { commentedAt: old });
    const { ch } = fakeChannel();
    await runCommentSends(svc(), () => ch, { now: () => at(90) });
    expect((await statusOf(c.commentId)).dm_status).toBe("expired");
  });

  it("арендатор не может забрать отправки и записать итог за отправщика", async () => {
    await expect(asA().call("claim_comment_sends", { p_limit: 1 })).rejects.toThrow(/permission/);
    await expect(
      asA().call("note_external_dm", { p_bot_id: A, p_channel: "instagram", p_external_id: "x" }),
    ).rejects.toThrow(/permission/);
  });
});

describe("«+» в Direct → карточка с кнопкой, один раз", () => {
  async function dmSent() {
    const c = await comment("хочу");
    const { ch } = fakeChannel();
    await runCommentSends(svc(), () => ch, { now: () => at(61) });
    expect((await statusOf(c.commentId)).card_status).toBe("awaiting_plus");
    return c;
  }

  it("ответ «+» — карточка с одной кнопкой «Купить»; второй «+» отвечает бот", async () => {
    const c = await dmSent();
    const { ch, sent } = fakeChannel();
    const input = {
      botId: A,
      buyerId: c.buyerId,
      conversationId: "igsid",
      lang: "kk",
      now: at(120),
    };
    expect(await onDirectMessage(asA(), ch, input)).toEqual({ handled: true, outcome: "sent" });
    expect(sent).toEqual([
      {
        kind: "card",
        to: "igsid",
        text: "Рабочая тетрадь — 4 500 ₸",
        buttons: [{ kind: "buy", productId: notebook, label: "Сатып алу" }],
      },
    ]);
    expect(await onDirectMessage(asA(), ch, input)).toEqual({ handled: false });
    expect(sent).toHaveLength(1);
  });

  it("два «+» одновременно — карточка одна", async () => {
    const c = await dmSent();
    const { ch, sent } = fakeChannel();
    const input = { botId: A, buyerId: c.buyerId, conversationId: "igsid", now: at(120) };
    const r = await Promise.all([
      onDirectMessage(asA(), ch, input),
      onDirectMessage(asA(), ch, input),
    ]);
    expect(r.filter((x) => x.handled)).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("позже 24 часов — окно Instagram закрыто, карточки нет, отвечает бот", async () => {
    const c = await dmSent();
    const { ch, sent } = fakeChannel();
    const late = new Date(at(61).getTime() + 25 * 3_600_000);
    expect(
      await onDirectMessage(asA(), ch, {
        botId: A,
        buyerId: c.buyerId,
        conversationId: "x",
        now: late,
      }),
    ).toEqual({ handled: false });
    expect(sent).toHaveLength(0);
  });

  it("товар сняли с продажи — карточку не шлём, отвечает бот", async () => {
    const c = await dmSent();
    await pg.query(
      "update v4.products set status = 'archived', archived_at = now() where id = $1",
      [notebook],
    );
    try {
      const { ch, sent } = fakeChannel();
      expect(
        await onDirectMessage(asA(), ch, {
          botId: A,
          buyerId: c.buyerId,
          conversationId: "x",
          now: at(120),
        }),
      ).toEqual({ handled: false });
      expect(sent).toHaveLength(0);
      expect((await statusOf(c.commentId)).card_status).toBe("failed");
    } finally {
      await pg.query("update v4.products set status = 'active', archived_at = null where id = $1", [
        notebook,
      ]);
    }
  });

  it("чужой магазин карточку покупателя не заберёт", async () => {
    const c = await dmSent();
    const { ch, sent } = fakeChannel();
    expect(
      await onDirectMessage(asB(), ch, {
        botId: B,
        buyerId: c.buyerId,
        conversationId: "x",
        now: at(120),
      }),
    ).toEqual({ handled: false });
    expect(sent).toHaveLength(0);
  });
});
