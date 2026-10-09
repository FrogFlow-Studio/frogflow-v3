import { useRouteContext } from "@tanstack/react-router";
import { broadcastsFn } from "@/app/admin/broadcasts.functions";
import { adminT, type AdminKey, type AdminT } from "@/app/i18n/admin";
import { uploadFile } from "@/app/admin/upload-client";
import { type AudienceType } from "@/core/broadcasts/pure";
import { SEGMENT_KINDS } from "@/core/broadcasts/segments";

export type Data = Awaited<ReturnType<typeof broadcastsFn>>;

export type Broadcast = Data["broadcasts"][number];

export type WhatsApp = NonNullable<Data["whatsapp"]>;

export type Template = WhatsApp["templates"][number];

export type Channel = "telegram" | "whatsapp";

/** «Сегмент» — в форме отдельный вариант; на сервер уходит как «все» + segment. */
export type UiAudience = AudienceType | "segment";

export type SegmentKind = (typeof SEGMENT_KINDS)[number];

export type SegmentDraft = {
  kind: SegmentKind;
  productId: string;
  /** Название выбранного товара — только для формы, в сегмент не уходит. */
  productName: string;
  categoryId: string;
  days: string;
  locale: string;
  tag: string;
  who: "all" | "behind" | "homework" | "completed";
  cohortId: string;
};

/** Сегменты по покупкам и корзине: консультанту без продаж их не из чего собрать. */
export const SALES_SEGMENTS: readonly SegmentKind[] = ["product", "category", "inactive", "cart"];

export const EMPTY_SEGMENT: SegmentDraft = {
  kind: "product",
  productId: "",
  productName: "",
  categoryId: "",
  days: "30",
  locale: "ru",
  tag: "",
  who: "all",
  cohortId: "",
};

/** Черновик сегмента → то, что примет parseSegment; незаполненный — undefined. */
export function segmentOf(d: SegmentDraft): Record<string, unknown> | undefined {
  switch (d.kind) {
    case "product":
      return d.productId ? { kind: "product", productId: d.productId } : undefined;
    case "category":
      return d.categoryId ? { kind: "category", categoryId: d.categoryId } : undefined;
    case "inactive":
      return Number(d.days) >= 1 ? { kind: "inactive", days: Number(d.days) } : undefined;
    case "language":
      return { kind: "language", locale: d.locale };
    case "cart":
      return { kind: "cart" };
    case "tag":
      return d.tag.trim() ? { kind: "tag", tag: d.tag.trim() } : undefined;
    case "course":
      return d.productId
        ? { kind: "course", productId: d.productId, who: d.who, cohortId: d.cohortId || null }
        : undefined;
  }
}

/** `sellsOnly` — аудитория по покупкам: консультанту без продаж (BOVI) не показывается. */
export const AUDIENCES: Array<{
  value: UiAudience;
  label: AdminKey;
  hint: AdminKey;
  tgOnly?: boolean;
  sellsOnly?: boolean;
}> = [
  { value: "all", label: "broadcasts.audience.all", hint: "broadcasts.audience.allHint" },
  {
    value: "buyers",
    label: "broadcasts.audience.buyers",
    hint: "broadcasts.audience.buyersHint",
    sellsOnly: true,
  },
  {
    value: "non_buyers",
    label: "broadcasts.audience.nonBuyers",
    hint: "broadcasts.audience.nonBuyersHint",
    sellsOnly: true,
  },
  {
    value: "country",
    label: "broadcasts.audience.country",
    hint: "broadcasts.audience.countryHint",
  },
  {
    value: "segment",
    label: "broadcasts.audience.segment",
    hint: "broadcasts.audience.segmentHint",
    tgOnly: true,
  },
  {
    value: "test",
    label: "broadcasts.audience.test",
    hint: "broadcasts.audience.testHint",
    tgOnly: true,
  },
];

export const STATUS: Record<
  string,
  { label: AdminKey; tone: "neutral" | "ok" | "warn" | "danger" | "accent" }
> = {
  queued: { label: "broadcasts.status.queued", tone: "accent" },
  sending: { label: "broadcasts.status.sending", tone: "accent" },
  completed: { label: "broadcasts.status.completed", tone: "ok" },
  cancelled: { label: "broadcasts.status.cancelled", tone: "neutral" },
  failed: { label: "broadcasts.status.failed", tone: "danger" },
};

export const TEMPLATE_STATUS: Record<
  string,
  { label: AdminKey; tone: "ok" | "warn" | "danger" | "neutral" }
> = {
  APPROVED: { label: "broadcasts.templateStatus.approved", tone: "ok" },
  PENDING: { label: "broadcasts.templateStatus.pending", tone: "warn" },
  IN_APPEAL: { label: "broadcasts.templateStatus.inAppeal", tone: "warn" },
  REJECTED: { label: "broadcasts.templateStatus.rejected", tone: "danger" },
  PAUSED: { label: "broadcasts.templateStatus.paused", tone: "danger" },
  DISABLED: { label: "broadcasts.templateStatus.disabled", tone: "danger" },
  PENDING_DELETION: { label: "broadcasts.templateStatus.pendingDeletion", tone: "neutral" },
};

/** Языки шаблона — самоназвания, одинаковы на любом языке панели. */
export const LANGUAGES = [
  { code: "ru", label: "Русский" },
  { code: "kk", label: "Қазақша" },
  { code: "en", label: "English" },
  { code: "uz", label: "Oʻzbekcha" },
];

/** Словарь панели для вложенных компонентов страницы. */
export function useT(): AdminT {
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  return adminT(shop.locale);
}

export async function uploadImage(file: File, t: AdminT): Promise<string> {
  return uploadFile("image", file, t, (status) => t("broadcasts.uploadFailed", { status }));
}
