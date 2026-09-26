import { afterEach, describe, expect, it, vi } from "vitest";
import { setEnvForTests } from "@/config/env";
import { listConversationMessages } from "./api.server";
import type { ZernioInboxMessage } from "./inbox-types";
import { findManagerMessage } from "./manager-guard";

/**
 * Zernio отдаёт не больше ста сообщений за раз. С сортировкой по возрастанию
 * это сто ПЕРВЫХ: в живом диалоге самое свежее исходящее в таком ответе было
 * недельной давности, хотя менеджер писал сегодня. Поэтому просим последние,
 * а хронологический порядок наружу восстанавливаем сами.
 */

afterEach(() => {
  setEnvForTests(undefined);
  vi.unstubAllGlobals();
});

function zernioReturns(messages: ZernioInboxMessage[]) {
  setEnvForTests({ ZERNIO_API_KEY: "sk_test" });
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messages }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("listConversationMessages: порядок переписки", () => {
  it("ответ от новых к старым разворачивается в хронологический", async () => {
    const fetchMock = zernioReturns([
      { id: "3", message: "третье", createdAt: "2026-09-20T09:12:00.000Z" },
      { id: "2", message: "второе", createdAt: "2026-09-20T09:11:00.000Z" },
      { id: "1", message: "первое", createdAt: "2026-09-20T09:10:00.000Z" },
    ]);
    const list = await listConversationMessages("acc-1", "conv-1");
    expect(list.map((m) => m.id)).toEqual(["1", "2", "3"]);
    // Просим именно последние сто, а не первые.
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(new URL(url).searchParams.get("sortOrder")).toBe("desc");
  });

  it("ответ уже в хронологическом порядке не портится", async () => {
    zernioReturns([
      { id: "1", message: "первое", createdAt: "2026-09-20T09:10:00.000Z" },
      { id: "2", text: "второе", sentAt: "2026-09-20T09:11:00.000Z" },
    ]);
    const list = await listConversationMessages("acc-1", "conv-1");
    expect(list.map((m) => m.id)).toEqual(["1", "2"]);
  });

  it("последним оказывается самое свежее — его и видит защита от перебивания менеджера", async () => {
    zernioReturns([
      {
        id: "new",
        message: "сейчас не работаем",
        createdAt: "2026-09-20T09:12:20.000Z",
        direction: "outgoing",
      },
      {
        id: "old",
        message: "старое",
        createdAt: "2026-09-15T19:57:05.464Z",
        direction: "outgoing",
      },
    ]);
    const list = await listConversationMessages("acc-1", "conv-1");
    expect(list.at(-1)?.id).toBe("new");
    const now = Date.parse("2026-09-20T09:13:00.000Z");
    expect(findManagerMessage(list, { ourReplies: [] }, now)?.text).toBe("сейчас не работаем");
  });
});
