import { afterEach, describe, expect, it, vi } from "vitest";
import type { TelegramApi } from "./api";
import { COPY } from "./copy";

const signedFileUrl = vi.fn(
  async (path: string, _ttl?: number, _name?: string) => `https://storage.invalid/${path}`,
);
vi.mock("@/core/orders/orders", () => ({ signedFileUrl }));

const { telegramMaterialSender, TELEGRAM_UPLOAD_MAX } = await import("./deliver");
const { telegramUpload, rejectedForSure } = await import("./api");

function fakeApi() {
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  const api: TelegramApi = {
    call: async (method, payload) => {
      calls.push({ method, payload: payload as Record<string, unknown> });
      return { ok: true };
    },
    fileUrl: (p) => p,
  };
  return { api, calls };
}

describe("telegramMaterialSender", () => {
  it("ссылка приоритетнее пути, если заданы оба: уходит ссылка, файл из хранилища не подписывается", async () => {
    const { api, calls } = fakeApi();
    const send = telegramMaterialSender(api, 42, COPY.ru);
    const r = await send({ name_snapshot: "Пазлы" } as never, [
      { path: "t/x.pdf", name: "Материал", url: "https://cdn.invalid/x.pdf" },
    ]);
    expect(r).toBe("sent");
    expect(signedFileUrl).not.toHaveBeenCalled();
    expect(calls.map((c) => c.method)).toEqual(["sendMessage"]);
    expect(String(calls[0]!.payload.text)).toContain('href="https://cdn.invalid/x.pdf"');
  });

  it("файл из хранилища подписывается человеческим именем, а не ключом", async () => {
    // Размер не узнали (HEAD не ответил) — pdf уходит по ссылке, как раньше.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    const { api, calls } = fakeApi();
    const send = telegramMaterialSender(api, 42, COPY.ru);
    const r = await send({ name_snapshot: "Пазлы БУКВЫ" } as never, [
      { path: "t/1782643012614-ni1xub.pdf", name: null, url: null },
    ]);
    expect(r).toBe("sent");
    expect(signedFileUrl).toHaveBeenCalledWith(
      "t/1782643012614-ni1xub.pdf",
      undefined,
      "Пазлы БУКВЫ.pdf",
    );
    expect(calls.map((c) => c.method)).toEqual(["sendDocument"]);
    vi.unstubAllGlobals();
  });
});

const MB = 1024 * 1024;

/**
 * Хранилище: HEAD отдаёт размер, GET — файл. Размер у каждого пути свой;
 * `bytes` — реальное тело (у больших — только заголовок: скачивать их не должны).
 */
function storage(files: Record<string, { size: number; type?: string }>) {
  const gets: string[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname.slice(1);
    const f = files[path];
    if (!f) return new Response("nope", { status: 404 });
    const headers = {
      "content-length": String(f.size),
      "content-type": f.type ?? "application/octet-stream",
    };
    if (init?.method === "HEAD") return new Response(null, { status: 200, headers });
    gets.push(path);
    return new Response(new Uint8Array(f.size), { status: 200, headers });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { gets };
}

type Upload = {
  method: string;
  fields: Record<string, string | number>;
  file: { field: string; name: string; data: Blob };
  opts?: { once?: boolean; timeoutMs?: number };
};

function uploadingApi(
  result: (u: Upload) => { ok: boolean; description?: string; error_code?: number } = () => ({
    ok: true,
  }),
) {
  const { api, calls } = fakeApi();
  const uploads: Upload[] = [];
  api.upload = async (method, fields, file, opts) => {
    const u = { method, fields, file, opts };
    uploads.push(u);
    return result(u);
  };
  return { api, calls, uploads };
}

describe("telegramMaterialSender: файл самим файлом до предела Bot API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("pptx 22 МБ уходит файлом с человеческим именем, а не ссылкой", async () => {
    const { gets } = storage({ "t/k.pptx": { size: 22 * MB } });
    const { api, calls, uploads } = uploadingApi();
    const r = await telegramMaterialSender(
      api,
      42,
      COPY.ru,
    )({ name_snapshot: "Пазлы" } as never, [{ path: "t/k.pptx", name: null, url: null }]);
    expect(r).toBe("sent");
    expect(gets).toEqual(["t/k.pptx"]);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.method).toBe("sendDocument");
    expect(uploads[0]!.fields).toEqual({ chat_id: 42, caption: "Пазлы" });
    expect(uploads[0]!.file.field).toBe("document");
    expect(uploads[0]!.file.name).toBe("Пазлы.pptx");
    expect(uploads[0]!.file.data.size).toBe(22 * MB);
    // Обрыв сети после приёма файла не должен прислать второй экземпляр.
    expect(uploads[0]!.opts?.once).toBe(true);
    expect(uploads[0]!.opts?.timeoutMs).toBeLessThanOrEqual(45_000);
    expect(calls).toEqual([]);
  });

  it("pdf 30 МБ — файлом: по ссылке Telegram берёт только до 20 МБ", async () => {
    storage({ "t/big.pdf": { size: 30 * MB } });
    const { api, calls, uploads } = uploadingApi();
    const r = await telegramMaterialSender(
      api,
      42,
      COPY.ru,
    )({ name_snapshot: "Прописи" } as never, [
      { path: "t/big.pdf", name: "Прописи.pdf", url: null },
    ]);
    expect(r).toBe("sent");
    expect(uploads.map((u) => u.method)).toEqual(["sendDocument"]);
    expect(calls).toEqual([]);
  });

  it("pdf до 20 МБ — по ссылке: Telegram скачает сам, функция файл не гоняет", async () => {
    const { gets } = storage({ "t/s.pdf": { size: 5 * MB } });
    const { api, calls, uploads } = uploadingApi();
    const r = await telegramMaterialSender(
      api,
      42,
      COPY.ru,
    )({ name_snapshot: "Прописи" } as never, [{ path: "t/s.pdf", name: null, url: null }]);
    expect(r).toBe("sent");
    expect(calls.map((c) => c.method)).toEqual(["sendDocument"]);
    expect(uploads).toEqual([]);
    expect(gets).toEqual([]);
  });

  it("больше предела Bot API (50 МБ) — ссылка на 7 дней, как в v1, файл не скачивается", async () => {
    const { gets } = storage({ "t/huge.mp4": { size: 96 * MB } });
    const { api, calls, uploads } = uploadingApi();
    const r = await telegramMaterialSender(
      api,
      42,
      COPY.ru,
    )({ name_snapshot: "Курс" } as never, [{ path: "t/huge.mp4", name: null, url: null }]);
    expect(r).toBe("sent");
    expect(uploads).toEqual([]);
    expect(gets).toEqual([]);
    expect(calls.map((c) => c.method)).toEqual(["sendMessage"]);
    expect(String(calls[0]!.payload.text)).toContain(COPY.ru.fileLink);
    expect(String(calls[0]!.payload.text)).toContain("96 МБ");
    expect(TELEGRAM_UPLOAD_MAX).toBe(50 * MB);
  });

  it("размер не известен заранее — скачивание обрывается на пределе, уходит ссылка", async () => {
    const f = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "HEAD"
        ? new Response(null, { status: 405 })
        : new Response(new Uint8Array(TELEGRAM_UPLOAD_MAX + 1), { status: 200 }),
    );
    vi.stubGlobal("fetch", f);
    const { api, calls, uploads } = uploadingApi();
    const r = await telegramMaterialSender(
      api,
      42,
      COPY.ru,
    )({ name_snapshot: "Курс" } as never, [{ path: "t/x.rar", name: null, url: null }]);
    expect(r).toBe("sent");
    expect(uploads).toEqual([]);
    expect(calls.map((c) => c.method)).toEqual(["sendMessage"]);
  });

  it("Telegram не принял файл или связь оборвалась — ссылка, повтор файла не шлётся", async () => {
    storage({ "t/k.docx": { size: 3 * MB } });
    const { api, calls, uploads } = uploadingApi(() => ({
      ok: false,
      description: "network error",
    }));
    const r = await telegramMaterialSender(
      api,
      42,
      COPY.ru,
    )({ name_snapshot: "Тетрадь" } as never, [{ path: "t/k.docx", name: null, url: null }]);
    expect(r).toBe("sent");
    expect(uploads).toHaveLength(1);
    expect(calls.map((c) => c.method)).toEqual(["sendMessage"]);
    expect(String(calls[0]!.payload.text)).toContain(COPY.ru.fileLink);
  });

  it("картинка до 10 МБ — фото в чате, как в v1; не приняли фото — документом", async () => {
    storage({ "t/p.jpg": { size: 2 * MB, type: "image/jpeg" } });
    const { api, uploads } = uploadingApi((u) =>
      u.method === "sendDocument" ? { ok: true } : { ok: false, error_code: 400 },
    );
    const r = await telegramMaterialSender(
      api,
      42,
      COPY.ru,
    )({ name_snapshot: "Раскраска" } as never, [{ path: "t/p.jpg", name: null, url: null }]);
    expect(r).toBe("sent");
    expect(uploads.map((u) => [u.method, u.file.field])).toEqual([
      ["sendPhoto", "photo"],
      ["sendDocument", "document"],
    ]);
  });

  it("фото ушло с обрывом или 5xx — документ вслед не шлётся, уходит ссылка", async () => {
    storage({ "t/p.jpg": { size: 2 * MB, type: "image/jpeg" } });
    for (const res of [
      { ok: false, description: "timeout" },
      { ok: false, error_code: 502 },
    ]) {
      const { api, calls, uploads } = uploadingApi(() => res);
      const r = await telegramMaterialSender(
        api,
        42,
        COPY.ru,
      )({ name_snapshot: "Раскраска" } as never, [{ path: "t/p.jpg", name: null, url: null }]);
      expect(r).toBe("sent");
      expect(uploads.map((u) => u.method)).toEqual(["sendPhoto"]);
      expect(calls.map((c) => c.method)).toEqual(["sendMessage"]);
    }
  });

  it("бюджет времени выдачи исчерпан — файл не скачивается, сразу ссылка", async () => {
    const { gets } = storage({ "t/k.pptx": { size: 22 * MB } });
    const { api, calls, uploads } = uploadingApi();
    const r = await telegramMaterialSender(
      api,
      42,
      COPY.ru,
      5_000,
    )({ name_snapshot: "Пазлы" } as never, [{ path: "t/k.pptx", name: null, url: null }]);
    expect(r).toBe("sent");
    expect(gets).toEqual([]);
    expect(uploads).toEqual([]);
    expect(calls.map((c) => c.method)).toEqual(["sendMessage"]);
  });
});

describe("telegramUpload с once: одна попытка", () => {
  afterEach(() => vi.unstubAllGlobals());
  const file = { field: "document", name: "a.pptx", data: new Blob([new Uint8Array(10)]) };

  it("обрыв сети — одна попытка, ok:false без кода", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", f);
    const r = await telegramUpload("T", "https://tg.invalid", "sendDocument", {}, file, {
      once: true,
    });
    expect(f).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ ok: false, description: "network error" });
    expect(rejectedForSure(r)).toBe(false);
  });

  it("5xx и 429 — без повтора; 400 — отказ наверняка", async () => {
    for (const [status, sure] of [
      [502, false],
      [429, false],
      [400, true],
    ] as const) {
      const f = vi.fn(async () =>
        Response.json({ ok: false, description: "x", parameters: { retry_after: 1 } }, { status }),
      );
      vi.stubGlobal("fetch", f);
      const r = await telegramUpload("T", "https://tg.invalid", "sendPhoto", {}, file, {
        once: true,
      });
      expect(f).toHaveBeenCalledTimes(1);
      expect(r.ok).toBe(false);
      // 5xx — «неизвестно»: без кода, как обрыв.
      expect(r.error_code).toBe(status >= 500 ? undefined : status);
      expect(rejectedForSure(r)).toBe(sure);
    }
  });

  it("каждая попытка ограничена по времени", async () => {
    const f = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_ok, fail) =>
          init?.signal?.addEventListener("abort", () => fail(init.signal!.reason)),
        ),
    );
    vi.stubGlobal("fetch", f);
    const r = await telegramUpload("T", "https://tg.invalid", "sendDocument", {}, file, {
      once: true,
      timeoutMs: 20,
    });
    expect(r).toEqual({ ok: false, description: "timeout" });
  });
});
