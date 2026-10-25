import { afterEach, describe, expect, it, vi } from "vitest";
import { imagePath } from "@/core/catalog/image-url";

const storageCalls: Array<{ bucket: string; key: string; ttl: number }> = [];
let signedUrlError: unknown = null;

vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (key: string, ttl: number) => {
          storageCalls.push({ bucket, key, ttl });
          return signedUrlError
            ? { data: null, error: signedUrlError }
            : { data: { signedUrl: `https://storage.test/${key}?token=temporary` }, error: null };
        },
      }),
    },
  }),
}));

const { productMediaAttachmentUrl } = await import("./media.server");

const BOT = "11111111-2222-3333-4444-555555555555";
const ctx = {
  tenant: { id: BOT },
  appUrl: "https://shop.test/",
} as never;

afterEach(() => {
  storageCalls.length = 0;
  signedUrlError = null;
  vi.restoreAllMocks();
});

describe("productMediaAttachmentUrl", () => {
  it("signs a tenant-owned storage key for Zernio and keeps the URL short-lived", async () => {
    const path = `${BOT}/0123456789abcdef01234567.mp4`;

    await expect(productMediaAttachmentUrl(ctx, path)).resolves.toBe(
      `https://storage.test/${path}?token=temporary`,
    );
    expect(storageCalls).toEqual([{ bucket: "product-images", key: path, ttl: 15 * 60 }]);
  });

  it("adds the tenant prefix to an older relative media key before signing", async () => {
    const path = "0123456789abcdef01234567.jpg";

    await productMediaAttachmentUrl(ctx, path);

    expect(storageCalls[0]).toEqual({
      bucket: "product-images",
      key: `${BOT}/${path}`,
      ttl: 15 * 60,
    });
  });

  it("falls back to the public proxy if Storage cannot issue a signed link", async () => {
    signedUrlError = new Error("storage unavailable");
    const path = `${BOT}/0123456789abcdef01234567.jpg`;

    await expect(productMediaAttachmentUrl(ctx, path)).resolves.toBe(
      imagePath(BOT, path).replace(/^/, "https://shop.test"),
    );
  });
});
