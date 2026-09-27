import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { imageUrl } from "@/core/catalog/catalog";
import { attachmentLogText, cleanFileName } from "./chat-attachment.server";

/**
 * Фото и документ в ответе продавца из «Чата»: файл сверяется с правилами
 * по бакету и уходит в канал покупателя. Хранилище, Telegram и Zernio
 * подменены, логика выбора канала и проверок — настоящая.
 */
const SHOP = "11111111-2222-3333-4444-555555555555";
const KEY = `${SHOP}/0123456789abcdef01234567`;
const MB = 1024 * 1024;

type Customer = {
  platform: string;
  zernioConversationId?: string;
  zernioAccountId?: string;
};
let customer: Customer | null = null;
let stored: { size: number; contentType: string; bytes?: Uint8Array } | null = null;
/** Настоящие первые байты по расширению ключа — как у честного файла. */
const REAL: Record<string, number[]> = {
  jpg: [0xff, 0xd8, 0xff, 0xe0],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  pdf: [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31],
  docx: [0x50, 0x4b, 0x03, 0x04],
  zip: [0x50, 0x4b, 0x03, 0x04],
};
const bytesFor = (key: string) => new Uint8Array(REAL[key.split(".").pop()!] ?? [0x4d, 0x5a]);
let tgRefuse: string | null = null;
const calls: { method: string; payload: Record<string, unknown> }[] = [];
const uploads: { method: string; fields: Record<string, unknown>; field: string; name: string }[] =
  [];
const zernio: { message: string; opts: Record<string, unknown> }[] = [];
const logged: string[] = [];

vi.mock("@/config/env", () => ({ env: () => ({ TELEGRAM_API_BASE: "https://tg" }) }));
vi.mock("@/core/customers/customers", () => ({ getCustomerByTelegramId: async () => customer }));
vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    storage: {
      from: (bucket: string) => ({
        info: async (key: string) =>
          stored
            ? {
                data: { size: stored.size, contentType: stored.contentType, bucket, key },
                error: null,
              }
            : { data: null, error: {} },
        download: async (key: string) => ({
          data: new Blob([(stored?.bytes ?? bytesFor(key)) as BlobPart]),
          error: null,
        }),
      }),
    },
  }),
}));
vi.mock("@/core/orders/orders", () => ({
  signedFileUrl: async (key: string, _ttl: number, name: string) =>
    `https://storage/${key}?download=${name}`,
}));
vi.mock("@/channels/telegram/api", () => ({
  telegramApi: () => ({
    call: async (method: string, payload: Record<string, unknown>) => {
      calls.push({ method, payload });
      return { ok: true };
    },
  }),
  telegramUpload: async (
    _t: string,
    _b: string,
    method: string,
    fields: Record<string, unknown>,
    file: { field: string; name: string },
  ) => {
    uploads.push({ method, fields, field: file.field, name: file.name });
    return tgRefuse ? { ok: false, description: tgRefuse } : { ok: true };
  },
}));
vi.mock("@/channels/zernio/api.server", () => ({
  sendInboxMessage: async (_c: string, _a: string, message: string, opts: object) => {
    zernio.push({ message, opts: opts as Record<string, unknown> });
    return { ok: true };
  },
}));
vi.mock("@/core/chat/chat", () => ({
  recordMessage: async (_ctx: unknown, m: { text: string }) => {
    logged.push(m.text);
  },
}));

const { replyAsManager } = await import("./admin.server");
const ctx = {
  tenant: { id: SHOP, settings: {} },
  appUrl: "https://shop.example",
  secrets: { telegramToken: () => "tok" },
} as unknown as TenantContext;

const photo = { kind: "photo" as const, key: `${KEY}.jpg`, name: "букет.jpg" };
const doc = { kind: "file" as const, key: `${KEY}.docx`, name: "C:\\fakepath\\Договор.docx" };
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

beforeEach(() => {
  customer = { platform: "telegram" };
  stored = { size: MB, contentType: "image/jpeg" };
  calls.length = 0;
  uploads.length = 0;
  zernio.length = 0;
  logged.length = 0;
  tgRefuse = null;
});

describe("ответ из «Чата» с фото или документом: Telegram", () => {
  it("фото уходит файлом с подписью, в журнале — пометка [фото]", async () => {
    await replyAsManager(ctx, 42, "Вот ваш букет", photo);
    expect(uploads).toEqual([
      {
        method: "sendPhoto",
        fields: { chat_id: 42, caption: "Вот ваш букет" },
        field: "photo",
        name: "букет.jpg",
      },
    ]);
    expect(calls).toEqual([]);
    expect(logged).toEqual(["[фото] Вот ваш букет"]);
  });

  it("документ уходит файлом с настоящим именем, без пути из браузера", async () => {
    stored = { size: 3 * MB, contentType: DOCX };
    await replyAsManager(ctx, 42, "", doc);
    expect(uploads).toEqual([
      { method: "sendDocument", fields: { chat_id: 42 }, field: "document", name: "Договор.docx" },
    ]);
    expect(logged).toEqual(["[файл: Договор.docx]"]);
  });

  it("текст длиннее подписи уходит отдельным сообщением после фото", async () => {
    const long = "а".repeat(1500);
    await replyAsManager(ctx, 42, long, photo);
    expect(uploads[0]!.fields).toEqual({ chat_id: 42 });
    expect(calls).toEqual([{ method: "sendMessage", payload: { chat_id: 42, text: long } }]);
  });

  it("Telegram не принял файл — длинный текст не уходит, продавцу понятная причина", async () => {
    tgRefuse = "Bad Request: PHOTO_INVALID_DIMENSIONS";
    const err = await replyAsManager(ctx, 42, "а".repeat(1500), photo).catch((e: unknown) => e);
    expect(err).toMatchObject({ name: "UserError", key: "err.admin.tgFileRejected" });
    expect(calls).toEqual([]);
    expect(logged).toEqual([]);
    tgRefuse = "Forbidden: bot was blocked by the user";
    await expect(replyAsManager(ctx, 42, "x", photo)).rejects.toMatchObject({
      key: "err.admin.tgBuyerUnreachable",
    });
  });
});

describe("ответ из «Чата» с фото или документом: Instagram и WhatsApp", () => {
  const zc = (platform: string) => ({
    platform,
    zernioConversationId: "conv",
    zernioAccountId: "acc",
  });

  it("фото уходит ссылкой на витринную картинку", async () => {
    for (const p of ["instagram", "whatsapp"]) {
      customer = zc(p);
      zernio.length = 0;
      await replyAsManager(ctx, 42, "Смотрите", photo);
      expect(zernio).toEqual([
        {
          message: "Смотрите",
          opts: {
            platform: p,
            attachmentUrl: imageUrl(ctx, photo.key),
            attachmentType: "image",
          },
        },
      ]);
    }
  });

  it("WhatsApp получает документ файлом с именем", async () => {
    customer = zc("whatsapp");
    stored = { size: MB, contentType: DOCX };
    await replyAsManager(ctx, 42, "Договор", doc);
    expect(zernio[0]!.opts).toMatchObject({
      attachmentType: "file",
      attachmentName: "Договор.docx",
      attachmentUrl: `https://storage/${doc.key}?download=Договор.docx`,
    });
  });

  it("Instagram: PDF уходит файлом", async () => {
    customer = zc("instagram");
    stored = { size: MB, contentType: "application/pdf" };
    await replyAsManager(ctx, 42, "Прайс", { kind: "file", key: `${KEY}.pdf`, name: "прайс.pdf" });
    expect(zernio[0]!.opts).toEqual({
      platform: "instagram",
      attachmentType: "file",
      attachmentName: "прайс.pdf",
      attachmentUrl: `https://storage/${KEY}.pdf?download=прайс.pdf`,
    });
  });

  it("Instagram: Word не принимает — уходит ссылка на 7 дней", async () => {
    customer = zc("instagram");
    stored = { size: MB, contentType: DOCX };
    await replyAsManager(ctx, 42, "Договор", doc);
    expect(zernio[0]!.opts).toEqual({ platform: "instagram" });
    expect(zernio[0]!.message).toBe(
      `Договор\n\n📎 Договор.docx: https://storage/${doc.key}?download=Договор.docx\nСсылка действует 7 дней.`,
    );
  });

  it("WhatsApp: ZIP файлом не принимает — уходит ссылкой", async () => {
    customer = zc("whatsapp");
    stored = { size: MB, contentType: "application/zip" };
    await replyAsManager(ctx, 42, "", { kind: "file", key: `${KEY}.zip`, name: "архив.zip" });
    expect(zernio[0]!.opts).toEqual({ platform: "whatsapp" });
    expect(zernio[0]!.message).toBe(
      `📎 архив.zip: https://storage/${KEY}.zip?download=архив.zip\nСсылка действует 7 дней.`,
    );
  });
});

describe("ответ из «Чата»: что отправить нельзя", () => {
  const rejected = async (att: Parameters<typeof replyAsManager>[3]) => {
    await expect(replyAsManager(ctx, 42, "x", att)).rejects.toThrow();
    expect(uploads).toEqual([]);
    expect(calls).toEqual([]);
    expect(zernio).toEqual([]);
    expect(logged).toEqual([]);
  };

  it("чужой ключ или ключ не по правилу выдачи", async () => {
    await rejected({
      ...photo,
      key: `99999999-2222-3333-4444-555555555555/0123456789abcdef01234567.jpg`,
    });
    await rejected({ ...photo, key: `${SHOP}/../other/x.jpg` });
    await rejected({ ...photo, key: `${SHOP}/old-product-photo.jpg` });
  });

  it("в бакете лежит не то, что пропускают правила", async () => {
    // Подтверждение загрузки пропустили и положили большое фото.
    stored = { size: 6 * MB, contentType: "image/jpeg" };
    await rejected(photo);
    // Под видом фото — страница.
    stored = { size: MB, contentType: "text/html" };
    await rejected(photo);
    // Документ с расширением программы.
    stored = { size: MB, contentType: "application/octet-stream" };
    await rejected({ kind: "file", key: `${KEY}.exe`, name: "setup.exe" });
  });

  it("содержимое не совпадает с расширением: программа или страница под видом документа", async () => {
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);
    const html = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");
    stored = { size: MB, contentType: "application/pdf", bytes: exe };
    await rejected({ kind: "file", key: `${KEY}.pdf`, name: "счёт.pdf" });
    stored = { size: MB, contentType: DOCX, bytes: html };
    await rejected({ kind: "file", key: `${KEY}.docx`, name: "договор.docx" });
    stored = { size: MB, contentType: "application/zip", bytes: exe };
    await rejected({ kind: "file", key: `${KEY}.zip`, name: "a.zip" });
    stored = { size: MB, contentType: "text/plain", bytes: exe };
    await rejected({ kind: "file", key: `${KEY}.txt`, name: "a.txt" });
    stored = { size: MB, contentType: "image/jpeg", bytes: html };
    await rejected(photo);
  });

  it("файла нет в бакете", async () => {
    stored = null;
    await rejected(photo);
  });
});

describe("имя файла и строка журнала", () => {
  it("имя без пути, служебных и невидимых символов; расширение — из проверенного ключа", () => {
    const pdf = `${KEY}.pdf`;
    expect(cleanFileName("C:\\Users\\a\\Смета.pdf", pdf)).toBe("Смета.pdf");
    expect(cleanFileName('../"<x>".pdf', pdf)).toBe("x.pdf");
    expect(cleanFileName("\u0000", pdf)).toBe("file.pdf");
    expect(cleanFileName("я".repeat(200) + ".pdf", pdf)).toHaveLength(104);
    // Смена направления текста: «invoice‮fdp.exe» на экране выглядит как «invoiceexe.pdf».
    expect(cleanFileName("invoice\u202Efdp.exe", pdf)).toBe("invoicefdp.pdf");
    // Нулевая ширина и точки.
    expect(cleanFileName("sc\u200Ban\u200D..\u2066.pdf", pdf)).toBe("scan.pdf");
    expect(cleanFileName("..", pdf)).toBe("file.pdf");
    // Имя обещает PDF, а ключ — ZIP: покупатель увидит .zip.
    expect(cleanFileName("прайс.pdf", `${KEY}.zip`)).toBe("прайс.zip");
  });

  it("журнал отличает фото от файла и сохраняет подпись", () => {
    expect(attachmentLogText(photo, " ")).toBe("[фото]");
    expect(attachmentLogText(doc, "Договор")).toBe("[файл: Договор.docx] Договор");
  });
});
