import { beforeEach, describe, expect, it, vi } from "vitest";

const patch = vi.fn(async (_id: string, _p: Record<string, unknown>) => ({}));
vi.mock("@/core/tenant/resolve.server", () => ({
  patchTenantSettings: (id: string, p: Record<string, unknown>) => patch(id, p),
}));

const { designView, saveDesign } = await import("./design.server");

const ctx = (design: unknown) =>
  ({ tenant: { id: "bot-1", settings: { storefront_design: design } } }) as never;

describe("сохранение оформления", () => {
  beforeEach(() => patch.mockClear());

  it("форма фото пишется рядом с темой через patchTenantSettings", async () => {
    const d = await saveDesign(ctx({}), {
      theme: "warm",
      cover: false,
      blocks: ["new"],
      photo: "portrait",
    });
    expect(d.photo).toBe("portrait");
    expect(patch).toHaveBeenCalledWith("bot-1", {
      storefront_design: { theme: "warm", cover: false, blocks: ["new"], photo: "portrait" },
    });
  });

  it("неизвестная форма сохраняется как квадрат", async () => {
    await saveDesign(ctx({}), { theme: "fresh", cover: false, blocks: [], photo: "круг" });
    expect(patch.mock.calls[0]![1]).toMatchObject({ storefront_design: { photo: "square" } });
  });

  it("старое оформление без формы читается как квадрат", () => {
    expect(designView(ctx({ theme: "classic", cover: true, blocks: [] })).photo).toBe("square");
  });
});
