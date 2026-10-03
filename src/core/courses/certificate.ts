import { randomInt } from "node:crypto";
import type { HomeworkStatus } from "./homework";

/**
 * Сертификат по окончании курса (ниша «Онлайн-школа»). Выдаётся, когда
 * курс пройден: открыты все уроки и приняты все домашние задания (тариф без
 * проверки ДЗ — когда ученик отметил все уроки пройденными).
 */
export type CertificateInput = {
  lessons: ReadonlyArray<{ id: string; homework: string | null }>;
  /** Урок уже открыт ученику. */
  open: ReadonlySet<string>;
  /** Урок отмечен пройденным. */
  done: ReadonlySet<string>;
  /** Статус сдачи по уроку; нет записи — не сдавал. */
  homework: ReadonlyMap<string, HomeworkStatus>;
  /** Проверка ДЗ входит в тариф. */
  checksHomework: boolean;
};

export function certificateReady(c: CertificateInput): boolean {
  if (c.lessons.length === 0) return false;
  if (!c.lessons.every((l) => c.open.has(l.id))) return false;
  const tasks = c.lessons.filter((l) => l.homework);
  if (c.checksHomework && tasks.length > 0)
    return tasks.every((l) => c.homework.get(l.id) === "accepted");
  return c.lessons.every((l) => c.done.has(l.id));
}

/** Код проверки: без похожих знаков (0/O, 1/I), 12 знаков — не подобрать перебором. */
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const CERT_CODE_LEN = 12;
export const CERT_CODE_RE = /^[2-9A-HJ-NP-Z]{12}$/;

export function newCertificateCode(): string {
  let s = "";
  for (let i = 0; i < CERT_CODE_LEN; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/** № 000123 — порядковый номер сертификата в магазине. */
export const certificateNo = (n: number) => String(n).padStart(6, "0");

export type Certificate = {
  code: string;
  no: number;
  orderItemId: string;
  student: string;
  course: string;
  issuedAt: string;
};

export function parseCertificate(raw: string | null | undefined): Certificate | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof o.code !== "string" ||
      !CERT_CODE_RE.test(o.code) ||
      !Number.isInteger(o.no) ||
      typeof o.orderItemId !== "string" ||
      typeof o.student !== "string" ||
      typeof o.course !== "string" ||
      typeof o.issuedAt !== "string"
    )
      return null;
    return {
      code: o.code,
      no: o.no as number,
      orderItemId: o.orderItemId,
      student: o.student.slice(0, 120),
      course: o.course.slice(0, 200),
      issuedAt: o.issuedAt,
    };
  } catch {
    return null;
  }
}
