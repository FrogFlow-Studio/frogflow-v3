import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cabinetFileResponse } from "@/app/cabinet/cabinet.server";
import { issueCabinetLink, revokeAccess } from "../core/access/access";
import { createOrder, recordPayment } from "../core/money/money";
import { pgliteV4, v4Db } from "../test/pg";
import { cabinetFile, openCabinet } from "./cabinet";

/**
 * Кабинет покупателя на настоящем Postgres, как у Копилки: тетрадь с
 * вариантами по классам, файлы у основного товара на ru и kk. Покупатель
 * на казахском видит казахский файл; скачать можно только своё и только
 * пока доступ действует; неверная ссылка — 404 без подробностей.
 */

const A = "aaaaaaaa-0000-4000-8000-0000000000ca";
let pg: PGlite;
const svc = () => pgliteV4(pg);
const asA = () => pgliteV4(pg, { botId: A });
let grade5: string;
let parent: string;
let fileKk: string;
let fileRu: string;
let n = 0;

async function buyer(lang: string | null) {
  return (
    await pg.query<{ id: string }>(
      "insert into v4.buyers (bot_id, country, language) values ($1, 'KZ', $2) returning id",
      [A, lang],
    )
  ).rows[0]!.id;
}
async function buy(b: string, productId: string) {
  const o = await createOrder(asA(), {
    botId: A,
    buyerId: b,
    country: "KZ",
    productIds: [productId],
    by: "bot",
  });
  if (!o.ok) throw new Error(o.code);
  const p = await recordPayment(asA(), {
    botId: A,
    orderId: o.value.id,
    amountMinor: o.value.totalMinor,
    currency: "KZT",
    method: "transfer",
    externalRef: `cab-${++n}`,
    by: "t",
  });
  if (!p.ok) throw new Error(p.code);
}
const signed = async (path: string, ttl?: number, name?: string) =>
  `https://storage.test/${path}?ttl=${ttl}&name=${encodeURIComponent(name ?? "")}`;

beforeAll(async () => {
  pg = await v4Db();
  await pg.query("insert into v4.shops (bot_id, base_currency) values ($1, 'KZT')", [A]);
  parent = (
    await pg.query<{ id: string }>(
      "insert into v4.products (bot_id, title, kind, base_price_minor) values ($1, 'Рабочая тетрадь', 'file', 150000) returning id",
      [A],
    )
  ).rows[0]!.id;
  grade5 = (
    await pg.query<{ id: string }>(
      "insert into v4.products (bot_id, title, kind, base_price_minor, parent_id, variant_label) values ($1, 'Рабочая тетрадь', 'file', 150000, $2, '5 класс') returning id",
      [A, parent],
    )
  ).rows[0]!.id;
  const f = await pg.query<{ id: string; language: string }>(
    `insert into v4.product_files (bot_id, product_id, language, storage_path, file_name, sort) values
       ($1, $2, 'ru', 'kop/5-ru.pdf', '5 класс.pdf', 1), ($1, $2, 'kk', 'kop/5-kk.pdf', '5 сынып.pdf', 1)
     returning id, language`,
    [A, parent],
  );
  fileRu = f.rows.find((r) => r.language === "ru")!.id;
  fileKk = f.rows.find((r) => r.language === "kk")!.id;
}, 60_000);
afterAll(async () => {
  await pg?.close();
});

describe("кабинет покупателя", () => {
  it("вариант без своих файлов показывает файлы основного товара на языке покупателя", async () => {
    const b = await buyer("kk");
    await buy(b, grade5);
    const { token } = await issueCabinetLink(svc(), A, b);
    const cab = await openCabinet(svc(), A, token);
    expect(cab).toEqual({
      lang: "kk",
      entries: [
        expect.objectContaining({
          title: "Рабочая тетрадь · 5 класс",
          kind: "file",
          files: [{ id: fileKk, name: "5 сынып.pdf" }],
        }),
      ],
    });
  });

  it("скачивание: свой файл — 302 на подпись на 5 минут; чужая ссылка, мусор и отозванный доступ — 404", async () => {
    const b = await buyer("ru");
    await buy(b, grade5);
    const { token } = await issueCabinetLink(svc(), A, b);
    const ok = await cabinetFileResponse(A, token, fileRu, svc(), signed);
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toBe(
      `https://storage.test/kop/5-ru.pdf?ttl=300&name=${encodeURIComponent("5 класс.pdf")}`,
    );
    // Покупатель без покупки этого товара.
    const stranger = await buyer("ru");
    const other = await issueCabinetLink(svc(), A, stranger);
    expect((await cabinetFileResponse(A, other.token, fileRu, svc(), signed)).status).toBe(404);
    expect(await openCabinet(svc(), A, other.token)).toBeNull();
    expect((await cabinetFileResponse(A, "плохой", fileRu, svc(), signed)).status).toBe(404);
    expect((await cabinetFileResponse(A, `${token}x`, fileRu, svc(), signed)).status).toBe(404);
    const access = (
      await pg.query<{ id: string }>("select id from v4.access where buyer_id = $1", [b])
    ).rows[0]!.id;
    const r = await revokeAccess(svc(), { botId: A, accessId: access, reason: "возврат", by: "t" });
    expect(r.ok).toBe(true);
    expect(await cabinetFile(svc(), A, token, fileRu)).toBeNull();
    expect(await openCabinet(svc(), A, token)).toBeNull();
  });

  it("старая ссылка — пустой кабинет", async () => {
    const b = await buyer(null);
    await buy(b, grade5);
    const { token } = await issueCabinetLink(svc(), A, b);
    await pg.query(
      "update v4.cabinet_links set expires_at = now() - interval '1 second' where buyer_id = $1",
      [b],
    );
    expect(await openCabinet(svc(), A, token)).toBeNull();
  });

  it("арендатору кабинет недоступен — только сервисной роли", async () => {
    await expect(
      asA().call("cabinet_files", { p_bot_id: A, p_token_sha256: "0".repeat(64) }),
    ).rejects.toThrow(/permission/);
  });
});
