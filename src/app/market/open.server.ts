import { serviceDb, type Db } from "@/core/db/client.server";
import { pageAll } from "@/core/db/page";
import { serverFailure } from "@/lib/server-failure";
import {
  OPEN_SOURCE,
  openVerdict,
  requestSignals,
  type OpenRequest,
} from "@/core/marketplace/open-request";
import { VERTICALS } from "@/core/verticals/registry";
import { sha256Hex } from "@/lib/hash";

/**
 * Приём заявки «Открыть свой магазин» (В19): заявка становится лидом оператора
 * (`sales_leads`, источник `market_open`), схема базы не меняется. Один контакт — одна
 * заявка в сутки: бронь ключом `operator_settings` (ключ уникален, из двух одновременных
 * отправок проходит одна, как у решённой задачи регистрации). Контакт, который уже есть в
 * воронке, нового лида не заводит — оператору остаётся событие «повторная заявка».
 */
export type SubmitResult =
  { status: "created" | "duplicate" } | { status: "refused"; reason: "ip" | "total" };

const DAY = 86_400_000;
const CLAIM_PREFIX = "market_open:";

type Deps = {
  svc?: Db;
  now?: () => Date;
};

const claimKey = (kind: string, value: string, now: Date) =>
  `${CLAIM_PREFIX}${kind}:${sha256Hex(`${kind}\0${value}`, 32)}:${now.toISOString().slice(0, 10)}`;

export async function submitOpenRequest(
  req: OpenRequest,
  ipHash: string,
  deps: Deps = {},
): Promise<SubmitResult> {
  const svc = deps.svc ?? serviceDb();
  const now = (deps.now ?? (() => new Date()))();
  const since = new Date(now.getTime() - DAY).toISOString();
  const actor = `market:${ipHash.slice(0, 16)}`;

  // Лимиты: по адресу и общий за сутки. Не удалось посчитать — заявку не принимаем.
  const base = () =>
    svc
      .from("sales_leads")
      .select("id", { count: "exact", head: true })
      .eq("source", OPEN_SOURCE)
      .gte("created_at", since);
  const [byIp, total] = await Promise.all([base().eq("created_by", actor), base()]);
  if (byIp.error || total.error)
    throw serverFailure(
      `заявка площадки: лимиты не прочитаны: ${(byIp.error ?? total.error)!.message}`,
    );
  const verdict = openVerdict({ ip: byIp.count ?? 0, total: total.count ?? 0 });
  if (verdict) return { status: "refused", reason: verdict };

  // Бронь контактов на сутки. Просроченные брони убираем попутно.
  await svc
    .from("operator_settings")
    .delete()
    .like("key", `${CLAIM_PREFIX}%`)
    .lt("value", now.toISOString());
  const contacts: Array<["phone" | "email" | "instagram", string, string]> = [];
  if (req.phone) contacts.push(["phone", "phone", req.phone]);
  if (req.email) contacts.push(["email", "email", req.email]);
  if (req.instagramHandle) contacts.push(["instagram", "instagram_handle", req.instagramHandle]);
  const held: string[] = [];
  const release = async () => {
    for (const key of held) await svc.from("operator_settings").delete().eq("key", key);
  };
  let taken = false;
  for (const [kind, , value] of contacts) {
    const key = claimKey(kind, value, now);
    const { error } = await svc
      .from("operator_settings")
      .insert({ key, value: new Date(now.getTime() + 2 * DAY).toISOString() });
    if (!error) held.push(key);
    else if (error.code === "23505") taken = true;
    else {
      await release();
      throw serverFailure(`заявка площадки: бронь контакта не записана: ${error.message}`);
    }
  }
  if (taken) {
    await release();
    return { status: "duplicate" };
  }

  try {
    // Контакт уже в воронке (старый лид, другой источник): нового не заводим, оператору — событие.
    for (const [, column, value] of contacts) {
      const found = await pageAll<{ id: string }>(
        (from, to) =>
          svc.from("sales_leads").select("id").eq(column, value).order("id").range(from, to),
        "заявка площадки: воронка не прочитана",
      );
      if (found.length === 0) continue;
      const { error } = await svc.from("sales_lead_events").insert({
        lead_id: found[0]!.id,
        actor,
        kind: "market_repeat",
        detail: `Повторная заявка с площадки: ${req.businessName}`.slice(0, 500),
      });
      if (error) throw serverFailure(`заявка площадки: событие не записано: ${error.message}`);
      return { status: "duplicate" };
    }
    const { insertLead } = await import("@/app/operator/leads.server");
    await insertLead(
      {
        businessName: req.businessName,
        niche: VERTICALS[req.vertical].title,
        city: req.city,
        websiteUrl: null,
        instagramHandle: req.instagramHandle,
        phone: req.phone,
        email: req.email,
        signals: requestSignals(req),
      },
      actor,
      OPEN_SOURCE,
      "Заявка с площадки «Открыть свой магазин»",
    );
    return { status: "created" };
  } catch (e) {
    await release();
    throw e;
  }
}
