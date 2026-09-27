import type { ReactNode } from "react";

/**
 * Разметка сообщений Telegram (parse_mode HTML) для предпросмотра:
 * <b>, <i>, <u>, <s>, <code> и сущности &lt; &gt; &amp; &quot;. Без
 * innerHTML: неизвестный тег остаётся текстом, как его показал бы Telegram
 * при ошибке разметки.
 */
const TAGS = { b: "strong", i: "em", u: "u", s: "s", code: "code" } as const;
type Tag = keyof typeof TAGS;

const unescape = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

export type TgNode = string | { tag: Tag; children: TgNode[] };

export function parseTgHtml(html: string): TgNode[] {
  const root: TgNode[] = [];
  const stack: Array<{ tag: Tag; children: TgNode[] }> = [];
  const top = () => (stack.length ? stack[stack.length - 1]!.children : root);
  const re = /<(\/?)(b|i|u|s|code)>|[^<]+|</g;
  for (const m of html.matchAll(re)) {
    const [whole, close, tag] = m;
    if (!tag) {
      const text = unescape(whole);
      const list = top();
      const last = list[list.length - 1];
      if (typeof last === "string") list[list.length - 1] = last + text;
      else list.push(text);
      continue;
    }
    if (!close) {
      const node = { tag: tag as Tag, children: [] as TgNode[] };
      top().push(node);
      stack.push(node);
    } else if (stack.length && stack[stack.length - 1]!.tag === tag) {
      stack.pop();
    }
  }
  return root;
}

function render(nodes: TgNode[], key = ""): ReactNode[] {
  return nodes.map((n, i) => {
    if (typeof n === "string") return n;
    const El = TAGS[n.tag];
    return <El key={`${key}${i}`}>{render(n.children, `${key}${i}.`)}</El>;
  });
}

export function TgText({ html }: { html: string }) {
  return <span className="whitespace-pre-line break-words">{render(parseTgHtml(html))}</span>;
}
