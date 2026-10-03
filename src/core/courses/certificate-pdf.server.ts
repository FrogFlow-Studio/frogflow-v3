import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import { storefrontT, intlLocale } from "@/app/i18n/storefront";
import type { Locale } from "@/core/i18n/locale";
import { certificateNo, type Certificate } from "./certificate";

/**
 * PDF сертификата: A4 альбомный, имя, курс, дата, номер и адрес проверки.
 * Шрифт DejaVu Sans вшит (assets/fonts) — стандартные шрифты PDF не знают
 * кириллицы и казахских букв. Строки — из словаря витрины, на языке магазина.
 */
const W = 842;
const H = 595;
const INK = rgb(0.13, 0.15, 0.2);
const MUTED = rgb(0.42, 0.45, 0.5);
const ACCENT = rgb(0.18, 0.5, 0.35);

let fontBytes: Promise<Uint8Array> | null = null;
function loadFont(): Promise<Uint8Array> {
  fontBytes ??= import("../../../assets/fonts/DejaVuSans.ttf?inline").then(
    (m) => new Uint8Array(Buffer.from(String(m.default).split(",")[1] ?? "", "base64")),
  );
  return fontBytes;
}

/** Перенос по словам под ширину; слово длиннее строки режется по буквам. */
function wrap(text: string, font: PDFFont, size: number, max: number): string[] {
  const lines: string[] = [];
  let cur = "";
  const push = (w: string) => {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= max) return void (cur = next);
    if (cur) lines.push(cur);
    cur = "";
    for (const ch of w) {
      if (font.widthOfTextAtSize(cur + ch, size) > max && cur) {
        lines.push(cur);
        cur = "";
      }
      cur += ch;
    }
  };
  for (const w of text.split(/\s+/).filter(Boolean)) push(w);
  if (cur) lines.push(cur);
  return lines;
}

export async function certificatePdf(
  cert: Certificate,
  o: { locale: Locale; timezone: string; shop: string; url: string },
): Promise<Uint8Array> {
  const t = storefrontT(o.locale);
  const fontkit = (await import("@pdf-lib/fontkit")).default;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`${t("course.cert.title")} ${certificateNo(cert.no)}`);
  doc.setProducer("FrogFlow");
  const font = await doc.embedFont(await loadFont(), { subset: true });
  const page = doc.addPage([W, H]);
  page.drawRectangle({
    x: 24,
    y: 24,
    width: W - 48,
    height: H - 48,
    borderColor: ACCENT,
    borderWidth: 3,
  });

  const center = (text: string, y: number, size: number, color = INK) => {
    const w = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (W - w) / 2, y, size, font, color });
  };
  const block = (text: string, top: number, size: number, min: number, color = INK) => {
    let s = size;
    let lines = wrap(text, font, s, W - 160);
    while (lines.length > 2 && s > min) {
      s -= 2;
      lines = wrap(text, font, s, W - 160);
    }
    lines.slice(0, 3).forEach((l, i) => center(l, top - i * (s + 6), s, color));
    return top - Math.min(lines.length, 3) * (s + 6);
  };

  center(t("course.cert.title").toUpperCase(), H - 130, 44, ACCENT);
  center(t("course.cert.certifies"), H - 190, 16, MUTED);
  const afterName = block(cert.student, H - 245, 34, 18);
  center(t("course.cert.completed"), afterName - 14, 16, MUTED);
  block(`«${cert.course}»`, afterName - 60, 28, 16);

  const date = new Date(cert.issuedAt).toLocaleDateString(intlLocale(o.locale), {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: o.timezone,
  });
  center(
    `${t("course.cert.issued", { date })} · ${t("course.cert.number", { no: certificateNo(cert.no) })}`,
    112,
    13,
  );
  center(o.shop, 90, 13, MUTED);
  center(t("course.cert.verify", { url: o.url }), 52, 9, MUTED);
  return doc.save();
}
