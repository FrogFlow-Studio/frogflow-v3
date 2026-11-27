/**
 * Движение на главной Enveriq без библиотек: блоки с `data-reveal` проявляются
 * при прокрутке, числа с `data-count` досчитывают до своего значения.
 *
 * Без JS и при «уменьшить движение» в системе страница остаётся как есть:
 * всё видно сразу, числа сразу финальные (их же видит поисковик). Прячет блоки
 * только класс `ev-motion`, который вешается после проверки, причём то, что
 * уже на экране, помечается видимым до этого, чтобы первый экран не мигал.
 */
import { useEffect, type CSSProperties, type RefObject } from "react";

/** Задержка появления для элемента с `data-reveal`: `style={delay(i * 80)}`. */
export const delay = (ms: number): CSSProperties => ({ "--d": `${ms}ms` }) as CSSProperties;

const COUNT_MS = 1400;

/** «2 500+» → число 2500, разделитель групп « » и хвост «+». */
export function parseCount(text: string): { n: number; sep: string; tail: string } | null {
  const m = /^(\d{1,3}(?:([\s\u00a0\u202f])\d{3})*|\d+)(.*)$/su.exec(text);
  if (!m) return null;
  return { n: Number((m[1] ?? "").replace(/\D/g, "")), sep: m[2] ?? " ", tail: m[3] ?? "" };
}

/** 2500 и « » → «2 500». */
export function formatCount(n: number, sep: string): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

function countUp(el: HTMLElement) {
  const final = el.dataset.count ?? el.textContent ?? "";
  const p = parseCount(final);
  if (!p || p.n < 2) {
    el.textContent = final;
    return;
  }
  const start = performance.now();
  const tick = (now: number) => {
    const k = Math.min(1, (now - start) / COUNT_MS);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = k < 1 ? formatCount(p.n * eased, p.sep) + p.tail : final;
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function inView(el: Element) {
  const r = el.getBoundingClientRect();
  return r.top < window.innerHeight * 0.92 && r.bottom > 0;
}

/** Включает движение внутри `root`. Вызывается один раз на странице. */
export function useReveal(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const host = root.current;
    if (!host || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const show = (el: HTMLElement) => {
      el.dataset.in = "";
      el.querySelectorAll<HTMLElement>("[data-count]").forEach(countUp);
      if (el.hasAttribute("data-count")) countUp(el);
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          io.unobserve(e.target);
          show(e.target as HTMLElement);
        }
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.05 },
    );

    const items = host.querySelectorAll<HTMLElement>("[data-reveal]");
    for (const el of items) {
      if (inView(el)) el.dataset.in = "";
      else io.observe(el);
    }
    // Числа ниже первого экрана начинают с нуля и досчитывают при появлении.
    for (const el of host.querySelectorAll<HTMLElement>("[data-count]")) {
      const holder = el.closest<HTMLElement>("[data-reveal]");
      if (holder && holder.dataset.in === undefined && parseCount(el.dataset.count ?? "")) {
        const p = parseCount(el.dataset.count ?? "")!;
        el.textContent = `0${p.tail}`;
      } else if (!holder || holder.dataset.in !== undefined) countUp(el);
    }
    host.classList.add("ev-motion");
    return () => io.disconnect();
  }, [root]);
}
