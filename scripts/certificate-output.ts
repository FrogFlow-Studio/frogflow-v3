/**
 * Сертификат в собранном сервере: после сборки отрисовать PDF с кириллицей из
 * `.output` (или `.vercel/output`, или папка из аргумента) и убедиться, что шрифт и fontkit попали в
 * бандл. Без шрифта pdf-lib падает на первой кириллической букве, и ученик
 * получает 500 вместо сертификата — тесты на исходниках этого не видят.
 *
 *   node scripts/certificate-output.ts [папка сборки]
 */
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";

/** Где Nitro кладёт серверную сборку: обычная и Vercel (одна функция на всё). */
export const OUTPUT_ROOTS = [".output/server", ".vercel/output/functions"];

const CHUNK_RE = /^certificate-pdf\.server-.*\.mjs$/;

/** Путь к собранному модулю сертификата или null, если его нет ни в одной сборке. */
export function findCertificateChunk(roots: string[] = OUTPUT_ROOTS): string | null {
  const walk = (dir: string, depth: number): string | null => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of entries) {
      const path = join(dir, e.name);
      if (e.isFile() && CHUNK_RE.test(e.name)) return path;
      // Симлинки не идём: на Vercel они ведут наружу функции (см. check-vercel-output).
      if (e.isDirectory() && depth < 6) {
        const hit = walk(path, depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  };
  for (const root of roots) {
    const hit = walk(root, 0);
    if (hit) return hit;
  }
  return null;
}

/** Символы Юникода, для которых шрифт PDF отдаёт глифы (по таблицам ToUnicode). */
export function pdfCodePoints(pdf: Uint8Array): Set<number> {
  const text = Buffer.from(pdf).toString("latin1");
  const out = new Set<number>();
  const hex = (h: string) => parseInt(h.slice(0, 4), 16);
  for (const m of text.matchAll(/stream\r?\n/g)) {
    const start = m.index + m[0].length;
    const end = text.indexOf("endstream", start);
    if (end < 0) continue;
    let body: string;
    try {
      body = inflateSync(Buffer.from(text.slice(start, end), "latin1")).toString("latin1");
    } catch {
      continue;
    }
    if (!body.includes("begincmap")) continue;
    for (const c of body.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
      for (const p of c[1]!.matchAll(/<[0-9a-fA-F]+>\s*<([0-9a-fA-F]+)>/g)) out.add(hex(p[1]!));
    for (const c of body.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
      for (const p of c[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
        const [lo, hi] = [parseInt(p[1]!, 16), parseInt(p[2]!, 16)];
        for (let i = 0; i <= hi - lo && i < 65536; i++) out.add(hex(p[3]!) + i);
      }
  }
  return out;
}

/** Буквы строки, которых нет среди глифов PDF. */
export function missingLetters(text: string, glyphs: Set<number>): string[] {
  return [...new Set([...text].filter((ch) => /\p{L}/u.test(ch)))].filter(
    (ch) => !glyphs.has(ch.codePointAt(0)!),
  );
}

const SAMPLE = {
  code: "CHECKCHECK",
  no: 1,
  orderItemId: "00000000-0000-4000-8000-000000000000",
  student: "Әйгерім Қасымова Ғалия Өтеген Үмит Ұлан Қуаныш",
  course: "Основы акварели: цвет и свет",
  issuedAt: "2026-10-03T10:00:00.000Z",
};

async function main(): Promise<number> {
  // Аргумент — где искать сборку (verify передаёт временную папку Vercel-сборки).
  const chunk = findCertificateChunk(process.argv[2] ? [process.argv[2]] : OUTPUT_ROOTS);
  if (!chunk) {
    console.error(
      "certificate-output: в сборке нет модуля сертификата (искал в " +
        (process.argv[2] ? [process.argv[2]] : OUTPUT_ROOTS).join(", ") +
        ")",
    );
    return 1;
  }
  console.log(`certificate-output: ${chunk}`);
  const mod = (await import(pathToFileURL(resolve(process.cwd(), chunk)).href)) as {
    certificatePdf?: (c: typeof SAMPLE, o: Record<string, string>) => Promise<Uint8Array>;
  };
  if (typeof mod.certificatePdf !== "function") {
    console.error("certificate-output: модуль собран без certificatePdf");
    return 1;
  }
  let failed = false;
  for (const locale of ["ru", "kk", "en", "uz"]) {
    try {
      const pdf = await mod.certificatePdf(SAMPLE, {
        locale,
        timezone: "Asia/Almaty",
        shop: "Школа Анастасии",
        url: "https://school.test/cert/CHECKCHECK",
      });
      const head = Buffer.from(pdf.slice(0, 5)).toString();
      const missing = missingLetters(
        `${SAMPLE.student}${SAMPLE.course}Школа Анастасии`,
        pdfCodePoints(pdf),
      );
      if (head !== "%PDF-" || missing.length) {
        failed = true;
        console.error(
          `certificate-output: ${locale}: ${head !== "%PDF-" ? "это не PDF" : `нет глифов для «${missing.join("")}»`}`,
        );
      }
    } catch (e) {
      failed = true;
      console.error(`certificate-output: ${locale}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!failed) console.log("certificate-output: сертификат отрисован из сборки, шрифт на месте");
  return failed ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main());
