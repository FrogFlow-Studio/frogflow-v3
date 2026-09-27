import { describe, expect, it } from "vitest";
import {
  ZERNIO_V2_WEBHOOK_NAME,
  ZERNIO_WEBHOOK_EVENTS,
  foreignWebhooks,
  planV2Webhook,
  v2ProfileIds,
  type ZernioWebhookRecord,
} from "./webhook-fit";

/**
 * Вебхук v2 в Zernio: своя запись с фильтром по профилям клиентов на v2.
 * Главное правило — запись v1 (любой другой адрес) план никогда не меняет и
 * не выключает, иначе Instagram и WhatsApp у клиентов прежней платформы замолчат.
 */
const URL_V2 = "https://www.frogflow.tech/api/zernio/webhook";
const EVENTS = [...ZERNIO_WEBHOOK_EVENTS];

const V1_STORE: ZernioWebhookRecord = {
  _id: "v1-store",
  name: "FrogFlow Store Webhook",
  url: "https://aatech-pi.vercel.app/api/public/zernio/webhook",
  events: EVENTS,
  isActive: true,
};
const V1_SAME_NAME: ZernioWebhookRecord = {
  _id: "v1-named-like-v2",
  name: ZERNIO_V2_WEBHOOK_NAME,
  url: "https://bovi.vercel.app/api/zernio/webhook",
  events: EVENTS,
  isActive: true,
};
const OWN: ZernioWebhookRecord = {
  _id: "own",
  name: ZERNIO_V2_WEBHOOK_NAME,
  url: URL_V2,
  events: EVENTS,
  isActive: true,
  profileIds: ["p-b", "p-a"],
};

describe("вебхук v2 в Zernio", () => {
  it("записи нет — создаётся своя с фильтром по профилям; записи v1 не трогаются", () => {
    const plan = planV2Webhook([V1_STORE, V1_SAME_NAME], URL_V2, ["p-b", "p-a"]);
    expect(plan).toEqual({
      action: "create",
      body: {
        name: ZERNIO_V2_WEBHOOK_NAME,
        url: URL_V2,
        events: EVENTS,
        isActive: true,
        profileIds: ["p-a", "p-b"],
        accountIds: [],
      },
    });
  });

  it("своя запись без message.failed (подписана до сверки) — обновляется по кнопке оператора", () => {
    expect(EVENTS).toContain("message.failed");
    const old = { ...OWN, events: EVENTS.filter((e) => e !== "message.failed") };
    expect(planV2Webhook([V1_STORE, old], URL_V2, ["p-a", "p-b"])).toMatchObject({
      action: "update",
      id: "own",
      body: { events: EVENTS },
    });
  });

  it("своя запись с теми же профилями — ничего не пишется", () => {
    expect(planV2Webhook([V1_STORE, OWN], URL_V2, ["p-a", "p-b"])).toEqual({
      action: "unchanged",
      id: "own",
    });
    // Адрес с косой чертой в конце — та же запись.
    expect(planV2Webhook([{ ...OWN, url: `${URL_V2}/` }], URL_V2, ["p-a", "p-b"])).toMatchObject({
      action: "unchanged",
    });
  });

  it("новый клиент переехал, запись выключена или не слушает события — обновляется только своя", () => {
    for (const own of [
      OWN,
      { ...OWN, isActive: false },
      { ...OWN, events: ["message.received"] },
      { ...OWN, accountIds: ["acc"] },
    ]) {
      const plan = planV2Webhook([V1_STORE, own, V1_SAME_NAME], URL_V2, ["p-a", "p-b", "p-c"]);
      expect(plan).toMatchObject({ action: "update", id: "own", body: { accountIds: [] } });
    }
  });

  it("клиентов v2 с Zernio нет — пустой фильтр не отправляется (он значил бы «все профили»)", () => {
    expect(planV2Webhook([V1_STORE], URL_V2, [])).toEqual({ action: "none" });
    expect(planV2Webhook([V1_STORE, OWN], URL_V2, [])).toEqual({ action: "disable", id: "own" });
    expect(planV2Webhook([{ ...OWN, isActive: false }], URL_V2, [])).toEqual({ action: "none" });
  });

  it("при любом наборе записей план пишет только запись с адресом этого деплоя", () => {
    const sets: ZernioWebhookRecord[][] = [
      [V1_STORE],
      [V1_SAME_NAME],
      [V1_STORE, V1_SAME_NAME],
      [OWN, V1_STORE],
      [{ ...V1_STORE, profileIds: ["p-a"] }],
      [{ ...OWN, isActive: false }, V1_STORE],
    ];
    for (const set of sets)
      for (const profiles of [[], ["p-a"], ["p-a", "p-b"]]) {
        const plan = planV2Webhook(set, URL_V2, profiles);
        if ("id" in plan) expect(plan.id).toBe("own");
        if ("body" in plan) expect(plan.body.url).toBe(URL_V2);
      }
    expect(foreignWebhooks([V1_STORE, OWN, V1_SAME_NAME], URL_V2).map((w) => w._id)).toEqual([
      "v1-store",
      "v1-named-like-v2",
    ]);
  });

  it("фильтр — профили только клиентов на v2, без повторов и пустых", () => {
    const t = (served_by: string, profile_id?: string) => ({
      settings: { served_by, zernio: profile_id === undefined ? undefined : { profile_id } },
    });
    expect(
      v2ProfileIds([
        t("v2", "p-b"),
        t("v1", "p-v1"),
        t("v2", "p-a"),
        t("v2", "p-b"),
        t("v2"),
        t("v2", " "),
      ]),
    ).toEqual(["p-a", "p-b"]);
  });
});
