import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT } from "./live";
import { serviceDb } from "@/core/db/client.server";
import { newUploadKey, uploadProblem } from "@/core/storage/upload";

/**
 * Загрузка мимо Vercel на демо-клиенте: подписанная ссылка, файл больше
 * 4,5 МБ сырым PUT, как его шлёт браузер админки, сверка через info.
 */
const keys: string[] = [];
const bucket = () => serviceDb().storage.from("product-files");

describe.skipIf(!liveReady)("загрузка напрямую в Storage", () => {
  afterAll(async () => {
    if (keys.length) await bucket().remove(keys);
  });

  it("файл в 6 МБ ложится по подписанной ссылке и проходит сверку", async () => {
    const key = newUploadKey(DEMO_BOT, randomBytes(12).toString("hex"), "big.pdf");
    keys.push(key);
    const { data: signed, error } = await bucket().createSignedUploadUrl(key);
    expect(error).toBeNull();
    const body = new Uint8Array(6 * 1024 * 1024);
    const put = await fetch(signed!.signedUrl, {
      method: "PUT",
      body,
      headers: { "content-type": "application/pdf", "x-upsert": "false" },
    });
    expect(put.status).toBe(200);
    const { data: info } = await bucket().info(key);
    expect(info?.size).toBe(body.length);
    expect(uploadProblem("file", Number(info?.size), String(info?.contentType))).toBeNull();
  });
});
