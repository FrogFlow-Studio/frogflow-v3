import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { dispatchZernioEvent, isHandledEvent } from "./dispatch.server";

const handled: unknown[] = [];
vi.mock("./message-failed.server", () => ({
  handleMessageFailed: async (_ctx: unknown, payload: unknown) => {
    handled.push(payload);
    return { note: "не доставлено: тест" };
  },
}));

describe("dispatch: message.failed", () => {
  it("событие принимается и уходит в свой обработчик, а не в разбор входящего", async () => {
    expect(isHandledEvent("message.failed")).toBe(true);
    const ctx = { tenant: { id: "b", modules: {}, settings: {} } } as unknown as TenantContext;
    const payload = { event: "message.failed", message: { conversationId: "c" } };
    const r = await dispatchZernioEvent(ctx, "evt-1", payload);
    expect(r).toEqual({ status: "processed", note: "не доставлено: тест" });
    expect(handled).toEqual([payload]);
  });
});
