import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { ZernioApiError } from "./errors";

/**
 * Публикации для правила: отказ Zernio — ошибка, а не пустой список
 * (Educational Bot, 01.10: «в списках видео пусто» при чужом профиле Zernio).
 */
const zernio = vi.hoisted(() => ({ fail: true }));
vi.mock("./api.server", async (orig) => ({
  ...(await orig<typeof import("./api.server")>()),
  zernioRequest: vi.fn(async () => {
    if (zernio.fail) throw new ZernioApiError("Zernio API 403", { status: 403 });
    return { posts: [] };
  }),
}));

const ctx = {
  tenant: { id: "b", settings: { zernio: { accounts: [{ id: "acc-1", platform: "instagram" }] } } },
} as unknown as TenantContext;

describe("listPosts", () => {
  it("Zernio отказал во всех запросах — ошибка, а не «публикаций нет»", async () => {
    const { listPosts } = await import("./automations.server");
    zernio.fail = true;
    await expect(listPosts(ctx, "acc-1")).rejects.toBeInstanceOf(ZernioApiError);
  });

  it("Zernio ответил, публикаций нет — пустой список", async () => {
    const { listPosts } = await import("./automations.server");
    zernio.fail = false;
    await expect(listPosts(ctx, "acc-1")).resolves.toEqual([]);
  });
});
